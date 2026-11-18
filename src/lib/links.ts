/**
 * What is derived from [[Page title]] links and the content of pages: outgoing links, an outline of a page, and the link graph.
 * Reading the links themselves (`extractLinks`, `blockPlainText`) is in lib/pageText.ts, so everything agrees on what counts as a link.
 * Nothing here is stored: it is all worked out from the pages already kept, so there is no second copy to keep in step, it needs no
 * migration, never changes what syncs, and works the same on the desktop and in the browser.
 */
import type { Group, Page } from '../types';
import { withDescendants } from './groups';
import { blockPlainText, extractLinks, htmlToText } from './pageText';
import { boxEdges, incomingLinks, pageLabel } from './boxLinks';
import { isArchived, kindOf, libraryPages } from './pages';
import type { Block } from '../types';

/** Titles of the pages that `page` links to, in order of first appearance. */
export function linkedTitles(page: Page): string[] {
  return extractLinks(page.blocks.map(blockPlainText).join('\n'));
}

/** The page a link title means: the oldest page with that title (ignoring case), or null. */
export function resolveTitle(title: string, pages: Record<string, Page>): Page | null {
  const key = title.trim().toLowerCase();
  let best: Page | null = null;
  for (const p of libraryPages(pages)) {
    if (p.title.trim().toLowerCase() !== key) continue;
    if (!best || p.created < best.created || (p.created === best.created && p.id < best.id)) best = p;
  }
  return best;
}

/** The titles a page links to, remembered per version of its boxes so that typing on one page never re-reads all the others. */
const titlesCache = new WeakMap<Block[], string[]>();
function cachedTitles(p: Page): string[] {
  let t = titlesCache.get(p.blocks);
  if (!t) {
    t = linkedTitles(p);
    titlesCache.set(p.blocks, t);
  }
  return t;
}

/** Pages (and cards) that lead to `pageId`: they write [[its title]], or have a box linked to it. Worked out from the pages themselves, so it is always current. */
export function backlinksOf(pageId: string, pages: Record<string, Page>): { pageId: string; title: string }[] {
  const me = pages[pageId];
  if (!me || kindOf(me) === 'template') return [];
  const found = new Map<string, string>();
  for (const { page } of incomingLinks(pageId, pages)) found.set(page.id, pageLabel(page));
  if (kindOf(me) === 'page') {
    // Which page each title means (the oldest with that title), worked out once rather than for every link.
    const byTitle = new Map<string, Page>();
    for (const p of libraryPages(pages)) {
      const key = p.title.trim().toLowerCase();
      const have = byTitle.get(key);
      if (!have || p.created < have.created || (p.created === have.created && p.id < have.id)) byTitle.set(key, p);
    }
    for (const p of libraryPages(pages)) {
      if (p.id === pageId) continue;
      if (cachedTitles(p).some((t) => byTitle.get(t.trim().toLowerCase())?.id === pageId)) found.set(p.id, p.title || 'Untitled');
    }
  }
  return [...found].map(([id, title]) => ({ pageId: id, title })).sort((a, b) => a.title.localeCompare(b.title));
}

export interface Outgoing {
  title: string;
  /** The page it leads to; null when no page has that title yet. */
  page: Page | null;
}

export function outgoingLinks(page: Page, pages: Record<string, Page>): Outgoing[] {
  return linkedTitles(page).map((title) => ({ title, page: resolveTitle(title, pages) }));
}

export interface OutlineItem {
  blockId: string;
  /** 1–3 for headings; frames count as level 1. */
  level: number;
  text: string;
  kind: 'heading' | 'frame';
}

/** The headings of a page's text boxes and its frame titles, in reading order (top to bottom, then left to right). */
export function outline(page: Page): OutlineItem[] {
  const rows: { y: number; x: number; i: number; item: OutlineItem }[] = [];
  page.blocks.forEach((b, i) => {
    if (b.type === 'frame') {
      const text = b.title.trim();
      if (text) rows.push({ y: b.y, x: b.x, i, item: { blockId: b.id, level: 1, text, kind: 'frame' } });
    } else if (b.type === 'note' && b.style === 'text') {
      for (const m of b.html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
        const text = htmlToText(m[2]).trim();
        if (text) rows.push({ y: b.y, x: b.x, i, item: { blockId: b.id, level: Number(m[1]), text, kind: 'heading' } });
      }
    }
  });
  return rows.sort((a, b) => a.y - b.y || a.x - b.x || a.i - b.i).map((r) => r.item);
}

export interface GraphNode {
  id: string;
  title: string;
  links: number;
  kind: 'page' | 'card';
}
export interface GraphEdge {
  from: string;
  to: string;
  /** 'text' = a [[Page title]] written in a box; 'box' = a link made on a box, frame or card. A pair joined both ways shows as 'box'. */
  kind: 'text' | 'box';
  /** For box links: which box each starts at and (when it points at one) ends at, one entry per link made. Empty for plain [[text]] links. */
  via?: { fromBlock: string | null; toBlock: string | null }[];
}
export interface LinkGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export interface GraphOptions {
  /** Show cards as dots too. Default off, so the graph is the pages as before. */
  cards?: boolean;
  /** Include the links made on boxes and frames. Default on. */
  boxes?: boolean;
  /** Include [[Page title]] links. Default on. */
  text?: boolean;
}

/** Every page (and, if asked, card) and the links between them. `links` counts links in and out. Self-links and repeats are dropped. */
export function linkGraph(pages: Record<string, Page>, opts: GraphOptions = {}): LinkGraph {
  const { cards = false, boxes = true, text = true } = opts;
  const list = Object.values(pages).filter((p) => !isArchived(p) && (kindOf(p) === 'page' || (cards && kindOf(p) === 'card'))); // archived ones are put away
  const ids = new Set(list.map((p) => p.id));
  const count = new Map<string, number>(list.map((p) => [p.id, 0]));
  const seen = new Map<string, GraphEdge>();
  const add = (from: string, to: string, kind: GraphEdge['kind'], via?: { fromBlock: string | null; toBlock: string | null }) => {
    if (from === to || !ids.has(from) || !ids.has(to)) return;
    const key = from + '>' + to;
    const have = seen.get(key);
    if (have) {
      if (kind === 'box') {
        have.kind = 'box';
        if (via) (have.via ??= []).push(via);
      }
      return;
    }
    seen.set(key, { from, to, kind, ...(via ? { via: [via] } : {}) });
    count.set(from, (count.get(from) ?? 0) + 1);
    count.set(to, (count.get(to) ?? 0) + 1);
  };
  if (text) {
    for (const p of list) {
      for (const t of linkedTitles(p)) {
        const to = resolveTitle(t, pages);
        if (to) add(p.id, to.id, 'text');
      }
    }
  }
  if (boxes) for (const e of boxEdges(pages)) add(e.from, e.to, 'box', { fromBlock: e.fromBlock, toBlock: e.toBlock });
  return {
    nodes: list.map((p) => ({ id: p.id, title: pageLabel(p), links: count.get(p.id) ?? 0, kind: kindOf(p) === 'card' ? 'card' : 'page' })),
    edges: [...seen.values()],
  };
}

export interface GraphFilter {
  /** Only pages in this group or any group inside it (cards are left out while this is set). */
  groupId?: string | null;
  /** Only pages and cards carrying this tag. */
  tag?: string | null;
}

/** The graph limited to pages in a group and/or with a tag; links to anything left out go too. */
export function filterGraph(g: LinkGraph, pages: Record<string, Page>, groups: Group[], f: GraphFilter): LinkGraph {
  if (!f.groupId && !f.tag) return g;
  const inGroups = f.groupId ? withDescendants(groups, f.groupId) : null;
  const keep = new Set(
    g.nodes
      .filter((n) => {
        const p = pages[n.id];
        if (!p) return false;
        if (inGroups && (n.kind === 'card' || !p.groupId || !inGroups.has(p.groupId))) return false;
        return !f.tag || p.tags.includes(f.tag);
      })
      .map((n) => n.id),
  );
  const edges = g.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  const count = new Map<string, number>();
  for (const e of edges) {
    count.set(e.from, (count.get(e.from) ?? 0) + 1);
    count.set(e.to, (count.get(e.to) ?? 0) + 1);
  }
  return { nodes: g.nodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n, links: count.get(n.id) ?? 0 })), edges };
}

/** Only what is within `depth` links of one page or card (either direction), for a "local graph". */
export function neighbourhood(g: LinkGraph, id: string, depth = 1): LinkGraph {
  if (!g.nodes.some((n) => n.id === id)) return { nodes: [], edges: [] };
  const keep = new Set([id]);
  for (let d = 0; d < depth; d++) {
    for (const e of g.edges) {
      if (keep.has(e.from)) keep.add(e.to);
      if (keep.has(e.to)) keep.add(e.from);
    }
  }
  return { nodes: g.nodes.filter((n) => keep.has(n.id)), edges: g.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
}

/** A simple force layout in a width × height box, run for a fixed number of steps so the result is the same every time. */
export function layoutGraph(g: LinkGraph, width: number, height: number, steps = 220): Map<string, { x: number; y: number }> {
  const n = g.nodes.length;
  const pos = new Map<string, { x: number; y: number }>();
  const cx = width / 2;
  const cy = height / 2;
  g.nodes.forEach((node, i) => {
    const a = (i / Math.max(n, 1)) * Math.PI * 2;
    const r = Math.min(width, height) * 0.35;
    pos.set(node.id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  });
  if (n < 2) return pos;
  const k = Math.sqrt((width * height) / n) * 0.6;
  for (let s = 0; s < steps; s++) {
    const t = 1 - s / steps;
    const disp = new Map(g.nodes.map((nd) => [nd.id, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(g.nodes[i].id)!;
        const b = pos.get(g.nodes[j].id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) { dx = 0.01 * (i + 1); dy = 0.01 * (j + 1); d = Math.hypot(dx, dy); }
        const f = (k * k) / d;
        disp.get(g.nodes[i].id)!.x += (dx / d) * f;
        disp.get(g.nodes[i].id)!.y += (dy / d) * f;
        disp.get(g.nodes[j].id)!.x -= (dx / d) * f;
        disp.get(g.nodes[j].id)!.y -= (dy / d) * f;
      }
    }
    for (const e of g.edges) {
      const a = pos.get(e.from)!;
      const b = pos.get(e.to)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d * d) / k;
      disp.get(e.from)!.x -= (dx / d) * f;
      disp.get(e.from)!.y -= (dy / d) * f;
      disp.get(e.to)!.x += (dx / d) * f;
      disp.get(e.to)!.y += (dy / d) * f;
    }
    for (const nd of g.nodes) {
      const p = pos.get(nd.id)!;
      const dd = disp.get(nd.id)!;
      dd.x += (cx - p.x) * 0.05 * k * 0.1;
      dd.y += (cy - p.y) * 0.05 * k * 0.1;
      const len = Math.hypot(dd.x, dd.y) || 1;
      const step = Math.min(len, 12 * t + 1);
      p.x = Math.min(width - 24, Math.max(24, p.x + (dd.x / len) * step));
      p.y = Math.min(height - 24, Math.max(24, p.y + (dd.y / len) * step));
    }
  }
  return pos;
}
