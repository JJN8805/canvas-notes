import { cleanArrows, cleanBlocks, cleanTags } from '../lib/sanitize';
import type { Arrow, Block } from '../types';
import { blockPlainText, extractLinks } from './text';
import type { GraphRepo, SearchHit } from './repo';
import { uuidv5 } from './uuid';

/** The parts of a page the graph needs (structurally a subset of PageRecord). */
export interface LegacyPage {
  id: string;
  title: string;
  groupId: string | null;
  tags: string[];
  blocks: Block[];
  arrows?: Arrow[];
  created: number;
  deleted?: boolean;
  /** Version of the page the graph copy was built from; stored so a stale copy can be found later. */
  etag?: string;
}
export interface LegacyGroup {
  id: string;
  name: string;
  color: string;
  parentId?: string | null;
}

/** Block ids are only unique per page in practice (a sync conflict copy reuses them), but
 *  they are primary keys here, so a clashing id gets the page id appended. */
const SEP = '~';
const origId = (rowId: string) => rowId.split(SEP)[0];

/**
 * Keeps the graph tables in step with the existing page model: pages become `page` nodes,
 * their blocks and arrows become `blocks` and `connectors`, tags and groups become nodes
 * joined to pages by TAGGED / IN_GROUP edges, nested groups by PARENT_OF.
 *
 * The page tables stay the source of truth for now (they are what syncs). Every method
 * here is idempotent (diff against what is stored, then upsert / soft-delete), so running
 * it again after a crash or on unchanged data is safe and cheap.
 */
export class GraphMirror {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly repo: GraphRepo) {}

  /** One projection at a time, in call order (the desktop database has no real transactions). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Resolves once everything queued so far has finished. */
  idle(): Promise<void> {
    return this.queue.then(() => {});
  }

  /** Builds the whole graph from existing data. Used for the one-time import and for rebuilds. */
  importAll(data: { pages: LegacyPage[]; groups: LegacyGroup[] }): Promise<void> {
    return this.enqueue(() =>
      this.repo.transaction(async () => {
        await this.projectGroups(data.groups);
        for (const p of data.pages) await this.projectPage(p);
      }),
    );
  }

  /** After a page was saved or arrived from another device. */
  page(p: LegacyPage): Promise<void> {
    return this.enqueue(() => this.repo.transaction(() => this.projectPage(p)));
  }

  removePage(id: string): Promise<void> {
    return this.enqueue(() => this.repo.deleteNode(id));
  }

  /** The complete list of live groups (what saveGroups gets). Groups missing from it are deleted. */
  groups(list: LegacyGroup[]): Promise<void> {
    return this.enqueue(() => this.repo.transaction(() => this.projectGroups(list)));
  }

  /** One group arrived from another device. */
  group(g: LegacyGroup & { deleted?: boolean }): Promise<void> {
    return this.enqueue(() =>
      this.repo.transaction(async () => {
        if (g.deleted) await this.repo.deleteNode(g.id);
        else await this.putGroup(g);
      }),
    );
  }

  /* ---- queries (what the UI reads) ---- */

  backlinks(pageId: string) {
    return this.repo.backlinks(pageId);
  }

  /** Full-text search, with the title of the page each hit is on. Hits on deleted pages never appear. */
  async search(query: string, limit = 20): Promise<(SearchHit & { title: string })[]> {
    const out: (SearchHit & { title: string })[] = [];
    for (const h of await this.repo.searchBlocks(query, limit)) {
      const n = await this.repo.getNode(h.pageId);
      if (n) out.push({ ...h, title: n.title });
    }
    return out;
  }

  /* ---------------------------------------------------------------- */

  private async projectGroups(list: LegacyGroup[]) {
    const { repo } = this;
    for (const g of list) await repo.putNode({ id: g.id, type: 'group', title: g.name, color: g.color });
    for (const g of list) await this.setParent(g);
    const keep = new Set(list.map((g) => g.id));
    for (const n of await repo.listNodes('group')) if (!keep.has(n.id)) await repo.deleteNode(n.id);
  }

  private async putGroup(g: LegacyGroup) {
    await this.repo.putNode({ id: g.id, type: 'group', title: g.name, color: g.color });
    await this.setParent(g);
  }

  /** PARENT_OF: parent group -> child group. A group has at most one parent here. */
  private async setParent(g: LegacyGroup) {
    const { repo } = this;
    const parent = g.parentId && g.parentId !== g.id ? await repo.getNode(g.parentId) : null;
    await this.setEdges(g.id, 'in', 'PARENT_OF', parent ? [parent.id] : []);
  }

  /**
   * Makes the live edges of one type around `nodeId` exactly match `others`.
   * 'out' = nodeId is the source, 'in' = nodeId is the destination.
   */
  private async setEdges(nodeId: string, dir: 'out' | 'in', type: 'TAGGED' | 'IN_GROUP' | 'PARENT_OF', others: string[]) {
    const { repo } = this;
    const have = await repo.listEdges(dir === 'out' ? { src: nodeId, type } : { dst: nodeId, type });
    const want = new Set(others);
    for (const e of have) {
      const other = dir === 'out' ? e.dst : e.src;
      if (!want.has(other)) await repo.unlink(e.src, e.dst, type);
    }
    for (const o of want) await (dir === 'out' ? repo.link(nodeId, o, type) : repo.link(o, nodeId, type));
  }

  private async projectPage(raw: LegacyPage) {
    const { repo } = this;
    // A page that arrived damaged must not stop the search index from being built: repair it the way reading it does.
    const p: LegacyPage = { ...raw, title: typeof raw.title === 'string' ? raw.title : '', tags: cleanTags(raw.tags), blocks: cleanBlocks(raw.blocks), arrows: cleanArrows(raw.arrows) };
    if (p.deleted) {
      await repo.deleteNode(p.id);
      return;
    }
    await repo.putNode({ id: p.id, type: 'page', title: p.title, createdAt: p.created });

    // Blocks. `ids` maps the id the page uses to the row id (they differ only after a clash).
    const existing = await repo.listBlocks(p.id, true);
    const ids = new Map(existing.map((r) => [origId(r.id), r.id]));
    for (const b of p.blocks) {
      if (!ids.has(b.id)) {
        const other = await repo.getBlock(b.id, true);
        ids.set(b.id, other && other.page_id !== p.id ? `${b.id}${SEP}${p.id}` : b.id);
      }
      const { id, type, x, y, w, h, z, ...content } = b;
      // The graph's block table predates audio, PDF and card boxes: audio and PDFs are files there, a card is an embed,
      // and the real kind is kept in the content.
      const stored = type === 'audio' || type === 'pdf' ? 'file' : type === 'card' ? 'embed' : type;
      await repo.putBlock({
        id: ids.get(id)!, pageId: p.id, type: stored, x, y, w, h, z: Math.round(z ?? 0),
        content: stored !== type ? { ...content, kind: type } : content, plainText: blockPlainText(b),
      });
    }
    const liveBlocks = new Set(p.blocks.map((b) => b.id));
    for (const r of existing) if (r.deleted_at === null && !liveBlocks.has(origId(r.id))) await repo.deleteBlock(r.id);

    // Arrows -> connectors (an arrow whose ends are gone is dropped).
    const oldConns = await repo.listConnectors(p.id, true);
    const connIds = new Map(oldConns.map((r) => [origId(r.id), r.id]));
    const liveConns = new Set<string>();
    for (const a of p.arrows ?? []) {
      const from = ids.get(a.from);
      const to = ids.get(a.to);
      if (!from || !to || from === to || !liveBlocks.has(a.from) || !liveBlocks.has(a.to)) continue;
      if (!connIds.has(a.id)) {
        const other = await repo.getConnector(a.id, true);
        connIds.set(a.id, other && other.page_id !== p.id ? `${a.id}${SEP}${p.id}` : a.id);
      }
      liveConns.add(a.id);
      await repo.putConnector({
        id: connIds.get(a.id)!, pageId: p.id, fromBlockId: from, toBlockId: to,
        label: a.label ?? null, style: { heads: a.heads, style: a.style, z: a.z },
      });
    }
    for (const r of oldConns) if (r.deleted_at === null && !liveConns.has(origId(r.id))) await repo.deleteConnector(r.id);

    // Tags: one node per name, matched ignoring case.
    const tagIds: string[] = [];
    for (const name of p.tags) {
      const t =
        (await repo.findNodeByTitle('tag', name)) ??
        (await repo.putNode({ id: await uuidv5(`tag|${name.toLowerCase()}`), type: 'tag', title: name }));
      if (!tagIds.includes(t.id)) tagIds.push(t.id);
    }
    await this.setEdges(p.id, 'out', 'TAGGED', tagIds);

    // Group (the page model allows one; the edge model allows several).
    const group = p.groupId ? await repo.getNode(p.groupId) : null;
    await this.setEdges(p.id, 'out', 'IN_GROUP', group?.type === 'group' ? [group.id] : []);

    await this.refreshLinks(p.id);
    // Pages written earlier that link to this title (it may be new or renamed), and pages that linked to the old one.
    const affected = new Set(await repo.pageIdsLinkingTo(p.title));
    for (const e of await repo.listEdges({ dst: p.id, type: 'LINKS_TO' })) affected.add(e.src);
    affected.delete(p.id);
    for (const id of affected) await this.refreshLinks(id);

    // Last, so a projection that died half-way leaves a stale etag and is redone (see catchUp).
    if (p.etag) await repo.updateNode(p.id, { props: { etag: p.etag } });
  }

  /** Rebuilds the LINKS_TO edges of a page from the [[Title]] mentions in its stored blocks. */
  private async refreshLinks(pageId: string) {
    const { repo } = this;
    const want = new Map<string, string>(); // target page id -> block of the first mention
    for (const b of await repo.listBlocks(pageId)) {
      for (const title of extractLinks(b.plain_text)) {
        const target = await repo.findPageByTitle(title);
        if (target && target.id !== pageId && !want.has(target.id)) want.set(target.id, b.id);
      }
    }
    for (const e of await repo.listEdges({ src: pageId, type: 'LINKS_TO' })) {
      if (!want.has(e.dst)) await repo.unlink(pageId, e.dst, 'LINKS_TO');
    }
    for (const [dst, blockId] of want) await repo.link(pageId, dst, 'LINKS_TO', { block_id: blockId });
  }

  /**
   * Pages whose graph copy is out of date (a crash between a save and its projection, or a
   * save made while the graph was unavailable). `current` is each page's etag in the page tables.
   */
  async staleIds(current: { id: string; etag: string }[]): Promise<string[]> {
    const nodes = new Map((await this.repo.listNodes('page')).map((n) => [n.id, n]));
    return current.filter((c) => {
      const n = nodes.get(c.id);
      return !n || (JSON.parse(n.props) as { etag?: string }).etag !== c.etag;
    }).map((c) => c.id);
  }
}
