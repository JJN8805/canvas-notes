import { openDB, type DBSchema } from 'idb';
import { assertSafeFile } from './validate';
import { fileIdsOf, pageFileIds } from '../lib/files';
import { assembleBlocks, sha256Hex, shareBlocks } from '../lib/contentHash';
import type { Block, Group, GroupColor, Page } from '../types';
import { cleanDate, kindOf } from '../lib/pages';
import { isBlankPage, shouldSnapshot, snapshotsToDrop } from '../lib/history';
import { newId } from '../lib/util';
import {
  base64ToBytes,
  bytesToBase64,
  cleanVectorRow,
  newEtag,
  normalizePage,
  type GroupRecord,
  type NotesStorage,
  type PageRecord,
  type SaveResult,
  type Snapshot,
  type SyncStore,
  type VectorKey,
  type VectorRow,
} from './types';
import { cleanSheet } from '../lib/sheet';
import { cleanIcon } from '../lib/pageIcon';

type PageRow = PageRecord & { rev: number; synced: string | null };
type GroupRow = GroupRecord & { synced: string | null };

interface Schema extends DBSchema {
  pages: { key: string; value: PageRow };
  groups: { key: string; value: GroupRow };
  meta: { key: string; value: { groups: Group[] } };
  /** A file id. `blob` is how files were stored before they were matched by content; now `hash` points into `blobs`. */
  images: { key: string; value: ImageRow; indexes: { hash: string } };
  /** Each distinct file once, by its SHA-256. */
  blobs: { key: string; value: { hash: string; blob: Blob } };
  settings: { key: string; value: string };
  snapshots: { key: string; value: SnapRow; indexes: { pageId: string } };
  /** Each distinct box of the version history once, by fingerprint. */
  historyBlocks: { key: string; value: { hash: string; json: string } };
  /** Embeddings for searching by meaning, by `model|page|box|piece`. Derived data: not synced, not backed up. */
  embeddings: { key: string; value: VectorRow; indexes: { model: string } };
}

interface ImageRow {
  id: string;
  created: number;
  blob?: Blob;
  hash?: string;
  mime?: string;
  size?: number;
}
/** A saved version: its boxes as fingerprints (`refs`), or written out in full (`blocks`, the older form). */
type SnapRow = Omit<Snapshot, 'blocks'> & { refs?: string[]; blocks?: Block[] };

/** The key of a stored vector. */
const vecId = (model: string, k: VectorKey) => `${model}|${k.pageId}|${k.blockId}|${k.chunk}`;

const rowToPage = (r: PageRow): Page => normalizePage({ ...r });
const pageRecord = (r: PageRow): PageRecord => ({
  id: r.id, etag: r.etag, deleted: r.deleted, title: r.title, groupId: r.groupId,
  tags: r.tags, blocks: r.blocks, arrows: r.arrows, drawing: r.drawing ?? null, color: r.color ?? null, kind: kindOf(r), dailyDate: cleanDate(r.dailyDate), sheet: cleanSheet(r.sheet), ...(r.cover ? { cover: r.cover } : {}), ...(r.icon ? { icon: r.icon } : {}), ...(r.archived ? { archived: true } : {}), created: r.created, updated: r.updated,
});
const groupRecord = (r: GroupRow): GroupRecord => ({
  id: r.id, etag: r.etag, deleted: r.deleted, name: r.name, color: r.color, position: r.position, parentId: r.parentId ?? null,
  ...(r.scope === 'cards' ? { scope: 'cards' as const } : {}),
  ...(r.description ? { description: r.description } : {}),
});

/** Browser fallback so the UI can be developed with `npm run dev` without Tauri. */
export async function createWebStorage(dbName = 'canvas-notes'): Promise<NotesStorage> {
  const db = await openDB<Schema>(dbName, 5, {
    upgrade(d, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        d.createObjectStore('pages', { keyPath: 'id' });
        d.createObjectStore('meta');
        d.createObjectStore('images', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        d.createObjectStore('groups', { keyPath: 'id' });
        d.createObjectStore('settings');
      }
      if (oldVersion < 3) {
        d.createObjectStore('snapshots', { keyPath: 'id' }).createIndex('pageId', 'pageId');
      }
      if (oldVersion < 4) {
        d.createObjectStore('historyBlocks', { keyPath: 'hash' });
        d.createObjectStore('blobs', { keyPath: 'hash' });
        tx.objectStore('images').createIndex('hash', 'hash');
      }
      if (oldVersion < 5) {
        d.createObjectStore('embeddings', { keyPath: 'k' as never }).createIndex('model', 'model');
      }
    },
  });

  // One-time move of v1 data: give pages an etag, and groups their own rows.
  const legacy = await db.get('meta', 'groups');
  if (legacy) {
    for (let i = 0; i < legacy.groups.length; i++) {
      const g = legacy.groups[i];
      await db.put('groups', { ...g, parentId: null, position: i, etag: newEtag(), synced: null, deleted: false });
    }
    await db.delete('meta', 'groups');
  }
  for (const p of await db.getAll('pages')) {
    if (!p.etag) await db.put('pages', { ...p, etag: newEtag(), synced: null, deleted: false });
  }

  const urlCache = new Map<string, Promise<string>>();

  /* ---- history: versions of a page, kept on this device only. Each distinct box is stored once (historyBlocks). ---- */
  const sameContent = (a: { title: string; blocks: unknown; arrows: unknown }, b: { title: string; blocks: unknown; arrows: unknown }) =>
    a.title === b.title && JSON.stringify(a.blocks) === JSON.stringify(b.blocks) && JSON.stringify(a.arrows) === JSON.stringify(b.arrows);

  /** A saved version with its boxes put back together. */
  async function openVersion(row: SnapRow, lookup?: Map<string, string>): Promise<Snapshot> {
    const { refs, blocks, ...rest } = row;
    if (!refs) return { ...rest, blocks: blocks ?? [] };
    const map = lookup ?? new Map<string, string>();
    if (!lookup) for (const h of new Set(refs)) { const r = await db.get('historyBlocks', h); if (r) map.set(h, r.json); }
    return { ...rest, blocks: assembleBlocks(refs, map) };
  }
  const newestFirst = async (pageId: string) => (await db.getAllFromIndex('snapshots', 'pageId', pageId)).sort((a, b) => b.taken - a.taken);
  const listVersions = async (pageId: string): Promise<Snapshot[]> => {
    const rows = await newestFirst(pageId);
    const lookup = new Map<string, string>();
    for (const h of new Set(rows.flatMap((r) => r.refs ?? []))) { const r = await db.get('historyBlocks', h); if (r) lookup.set(h, r.json); }
    return Promise.all(rows.map((r) => openVersion(r, lookup)));
  };

  /** Removes stored boxes that no version uses any more. */
  async function sweepHistory() {
    const used = new Set<string>();
    for (const s of await db.getAll('snapshots')) for (const h of s.refs ?? []) used.add(h);
    for (const h of (await db.getAllKeys('historyBlocks')) as string[]) if (!used.has(h)) await db.delete('historyBlocks', h);
  }

  async function takeSnapshot(pageId: string, force: boolean): Promise<boolean> {
    const now = Date.now();
    const page = await db.get('pages', pageId);
    if (!page || page.deleted || isBlankPage(page)) return false;
    const have = await newestFirst(pageId);
    if (!force && !shouldSnapshot(have[0]?.taken ?? null, now)) return false;
    const { refs, store } = await shareBlocks(page.blocks);
    const newest = have[0];
    if (newest) {
      const same = newest.refs;
      if (same ? newest.title === page.title && JSON.stringify(newest.arrows) === JSON.stringify(page.arrows) && same.length === refs.length && same.every((h, i) => h === refs[i]) : sameContent({ ...newest, blocks: newest.blocks }, page)) return false;
    }
    for (const [hash, json] of store) await db.put('historyBlocks', { hash, json });
    await db.put('snapshots', { id: newId(), pageId, taken: now, title: page.title, refs, arrows: page.arrows });
    const drop = snapshotsToDrop([...have.map((s) => ({ id: s.id, taken: s.taken })), { id: '', taken: now }], now).filter((id) => id);
    for (const id of drop) await db.delete('snapshots', id);
    if (drop.length) await sweepHistory();
    return true;
  }
  /** A history problem must never fail a save or a sync. */
  const safeSnapshot = (pageId: string, force: boolean) => takeSnapshot(pageId, force).catch((e) => void console.error('history snapshot failed', e));
  const snapshotIfReplacing = async (rec: PageRecord) => {
    const cur = await db.get('pages', rec.id);
    if (cur && !cur.deleted && !sameContent(cur, rec)) await safeSnapshot(rec.id, true);
  };

  async function purgePage(id: string) {
    const tx = db.transaction('pages', 'readwrite');
    const p = await tx.store.get(id);
    if (p?.deleted) await tx.store.put({ ...p, title: '', tags: [], blocks: [], arrows: [], drawing: null, color: null, dailyDate: null, sheet: null, cover: null, icon: null, archived: false, etag: newEtag(), rev: p.rev + 1 });
    await tx.done;
    for (const s of await db.getAllFromIndex('snapshots', 'pageId', id)) await db.delete('snapshots', s.id);
    await sweepHistory();
  }

  /* ---- files: the same bytes are kept once, however many ids point at them ---- */
  /** The bytes of a stored file. */
  const blobOf = async (row: ImageRow): Promise<Blob | null> => row.blob ?? (row.hash ? ((await db.get('blobs', row.hash))?.blob ?? null) : null);
  /** Stores a file under an id. When the same bytes are already kept (under any id), only a small row is added and the bytes are not copied. */
  async function storeFile(id: string, blob: Blob): Promise<{ id: string; reused: boolean }> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = await sha256Hex(bytes);
    const mime = blob.type || 'image/png';
    if (!(await db.get('blobs', hash))) await db.put('blobs', { hash, blob });
    await db.put('images', { id, hash, mime, size: bytes.length, created: Date.now() });
    return { id, reused: false };
  }
  const twinOf = async (hash: string, mime: string) => (await db.getAllFromIndex('images', 'hash', hash)).find((r) => r.mime === mime);
  /** Removes a stored file once no id points at it. */
  async function dropBlobIfUnused(hash: string | undefined) {
    if (hash && !(await db.getAllFromIndex('images', 'hash', hash)).length) await db.delete('blobs', hash);
  }

  const store = (kind: 'page' | 'group') => (kind === 'page' ? 'pages' : 'groups');

  const sync: SyncStore = {
    async listMeta(kind) {
      const rows = (await db.getAll(store(kind))) as (PageRow | GroupRow)[];
      return rows.map((r) => ({ id: r.id, etag: r.etag, synced: r.synced, deleted: r.deleted }));
    },
    async getRecords(kind, ids) {
      const out = [];
      for (const id of ids) {
        if (kind === 'page') {
          const r = await db.get('pages', id);
          if (r) out.push(pageRecord(r));
        } else {
          const r = await db.get('groups', id);
          if (r) out.push(groupRecord(r));
        }
      }
      return out;
    },
    async applyRemote(kind, rec) {
      if (kind === 'page') {
        await snapshotIfReplacing(rec as PageRecord);
        const tx = db.transaction('pages', 'readwrite');
        const cur = await tx.store.get(rec.id);
        await tx.store.put({ ...(rec as PageRecord), rev: (cur?.rev ?? 0) + 1, synced: rec.etag });
        await tx.done;
      } else {
        await db.put('groups', { ...(rec as GroupRecord), synced: rec.etag });
      }
    },
    async applyRemoteIf(kind, rec, base) {
      if (kind === 'page' && base !== null) await snapshotIfReplacing(rec as PageRecord);
      if (kind === 'page') {
        const tx = db.transaction('pages', 'readwrite');
        const cur = await tx.store.get(rec.id);
        if ((cur?.etag ?? null) !== base) {
          await tx.done;
          return cur?.etag === rec.etag;
        }
        await tx.store.put({ ...(rec as PageRecord), rev: (cur?.rev ?? 0) + 1, synced: rec.etag });
        await tx.done;
        return true;
      }
      const tx = db.transaction('groups', 'readwrite');
      const cur = await tx.store.get(rec.id);
      if ((cur?.etag ?? null) !== base) {
        await tx.done;
        return cur?.etag === rec.etag;
      }
      await tx.store.put({ ...(rec as GroupRecord), synced: rec.etag });
      await tx.done;
      return true;
    },
    async markSynced(kind, id, etag) {
      if (kind === 'page') {
        const r = await db.get('pages', id);
        if (r) await db.put('pages', { ...r, synced: etag });
      } else {
        const r = await db.get('groups', id);
        if (r) await db.put('groups', { ...r, synced: etag });
      }
    },
    async insertLocalPage(r) {
      await db.put('pages', { ...r, etag: newEtag(), synced: null, deleted: false, rev: 1 });
    },
    async listImageIds() {
      return (await db.getAllKeys('images')) as string[];
    },
    async readImage(id) {
      const row = await db.get('images', id);
      const blob = row && (await blobOf(row));
      if (!row || !blob) return null;
      return { id, mime: row.mime ?? (blob.type || 'image/png'), data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
    },
    async writeImage(img) {
      assertSafeFile(img);
      if (await db.get('images', img.id)) return;
      await storeFile(img.id, new Blob([base64ToBytes(img.data)], { type: img.mime }));
    },
  };

  /** Merges files with the same content and converts older versions to the shared form. Each run finishes what it can. */
  const tidy: NotesStorage['tidy'] = async () => {
    let filesMerged = 0;
    let bytesFreed = 0;
    for (const row of await db.getAll('images')) {
      if (row.hash || !row.blob) continue; // already in the shared form
      const bytes = new Uint8Array(await row.blob.arrayBuffer());
      const hash = await sha256Hex(bytes);
      const mime = row.blob.type || 'image/png';
      const known = await db.get('blobs', hash);
      if (known) {
        filesMerged++;
        bytesFreed += bytes.length;
      } else await db.put('blobs', { hash, blob: row.blob });
      await db.put('images', { id: row.id, hash, mime, size: bytes.length, created: row.created });
    }
    let versionsConverted = 0;
    for (const s of await db.getAll('snapshots')) {
      if (!s.blocks) continue;
      const { refs, store } = await shareBlocks(s.blocks);
      for (const [hash, json] of store) await db.put('historyBlocks', { hash, json });
      const { blocks: _old, ...rest } = s;
      await db.put('snapshots', { ...rest, refs });
      versionsConverted++;
    }
    if (versionsConverted) await sweepHistory();
    return { filesMerged, bytesFreed, versionsConverted };
  };

  const report: NotesStorage['report'] = async () => {
    const pages = (await db.getAll('pages')).filter((p) => !p.deleted);
    const boxes = new Map((await db.getAll('historyBlocks')).map((r) => [r.hash, r.json.length]));
    const snaps = await db.getAll('snapshots');
    let versionBytes = 0;
    let versionBytesIfCopied = 0;
    let historyBoxUses = 0;
    for (const s of snaps) {
      if (s.refs) {
        historyBoxUses += s.refs.length;
        versionBytes += s.refs.length * 66;
        versionBytesIfCopied += 2 + s.refs.reduce((n, h) => n + (boxes.get(h) ?? 0) + 1, 0);
      } else {
        const n = JSON.stringify(s.blocks ?? []).length;
        versionBytes += n;
        versionBytesIfCopied += n;
      }
    }
    for (const n of boxes.values()) versionBytes += n;
    const images = await db.getAll('images');
    const sizeOf = (r: ImageRow) => r.size ?? r.blob?.size ?? 0;
    const byFile = new Map<string, number>();
    for (const r of images) byFile.set(r.hash ?? r.id, Math.max(byFile.get(r.hash ?? r.id) ?? 0, sizeOf(r)));
    return {
      pages: pages.length,
      pageBytes: pages.reduce((n, p) => n + JSON.stringify(p.blocks).length, 0),
      versions: snaps.length,
      versionBytes,
      versionBytesIfCopied,
      historyBoxes: boxes.size,
      historyBoxUses,
      fileUses: images.length,
      files: byFile.size,
      fileBytes: [...byFile.values()].reduce((a, b) => a + b, 0),
      fileBytesIfCopied: images.reduce((n, r) => n + sizeOf(r), 0),
      pending: images.filter((r) => !r.hash).length + snaps.filter((s) => s.blocks).length,
    };
  };

  return {
    kind: 'browser',
    tidy,
    report,
    sync,

    async location() {
      return 'this browser (IndexedDB)';
    },

    async loadAll() {
      const pages = (await db.getAll('pages')).filter((p) => !p.deleted).map(rowToPage);
      const groups = (await db.getAll('groups'))
        .filter((g) => !g.deleted)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((g): Group => ({ id: g.id, name: g.name, color: g.color as GroupColor, parentId: g.parentId ?? null, ...(g.scope === 'cards' ? { scope: 'cards' as const } : {}), ...(g.description ? { description: g.description } : {}) }));
      return { pages, groups };
    },

    async loadPage(id) {
      const p = await db.get('pages', id);
      return p && !p.deleted ? rowToPage(p) : null;
    },

    async savePage(page): Promise<SaveResult> {
      await safeSnapshot(page.id, false); // the page as it was before this save
      const tx = db.transaction('pages', 'readwrite');
      const existing = await tx.store.get(page.id);
      if (existing && !existing.deleted && existing.rev !== page.rev) {
        await tx.done;
        return { ok: false, reason: 'conflict' };
      }
      // A deleted page that is edited again comes back.
      const rev = existing ? existing.rev + 1 : 1;
      await tx.store.put({
        id: page.id, title: page.title, groupId: page.groupId, tags: page.tags, blocks: page.blocks, arrows: page.arrows, drawing: page.drawing ?? null, color: page.color ?? null, kind: kindOf(page), dailyDate: cleanDate(page.dailyDate), sheet: cleanSheet(page.sheet), ...(page.cover ? { cover: page.cover } : {}), ...(cleanIcon(page.icon) ? { icon: cleanIcon(page.icon)! } : {}), ...(page.archived === true ? { archived: true } : {}),
        created: page.created, updated: page.updated, rev, etag: newEtag(), synced: existing?.synced ?? null, deleted: false,
      });
      await tx.done;
      return { ok: true, rev };
    },

    async deletePage(id) {
      const tx = db.transaction('pages', 'readwrite');
      const p = await tx.store.get(id);
      if (p && !p.deleted) await tx.store.put({ ...p, deleted: true, etag: newEtag(), updated: Date.now(), rev: p.rev + 1 });
      await tx.done;
    },

    async listTrash() {
      return (await db.getAll('pages'))
        .filter((p) => p.deleted && kindOf(p) !== 'template' && !isBlankPage(p))
        .sort((a, b) => b.updated - a.updated)
        .map(rowToPage);
    },

    purgePage,

    async purgeExpiredTrash(cutoff) {
      const pages = await db.getAll('pages');
      const old = pages.filter((p) => p.deleted && p.updated < cutoff && !isBlankPage(p));
      for (const p of old) await purgePage(p.id);
      // History of pages whose tombstone is empty has nothing to come back to.
      for (const p of pages) {
        if (p.deleted && isBlankPage(p)) for (const s of await db.getAllFromIndex('snapshots', 'pageId', p.id)) await db.delete('snapshots', s.id);
      }
      await sweepHistory();
      return old.length;
    },

    listSnapshots: listVersions,

    snapshotPage(pageId, opts) {
      return takeSnapshot(pageId, !!opts?.force);
    },

    async saveGroups(groups) {
      const tx = db.transaction('groups', 'readwrite');
      const keep = new Set(groups.map((g) => g.id));
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const cur = await tx.store.get(g.id);
        const parentId = g.parentId ?? null;
        const scope = g.scope === 'cards' ? ('cards' as const) : undefined;
        const description = scope && g.description ? g.description : undefined;
        if (cur && !cur.deleted && cur.name === g.name && cur.color === g.color && cur.position === i && (cur.parentId ?? null) === parentId && cur.scope === scope && (cur.description || undefined) === description) continue;
        await tx.store.put({ id: g.id, name: g.name, color: g.color, position: i, parentId, ...(scope ? { scope } : {}), ...(description ? { description } : {}), etag: newEtag(), synced: cur?.synced ?? null, deleted: false });
      }
      for (const r of await tx.store.getAll()) {
        if (!keep.has(r.id) && !r.deleted) await tx.store.put({ ...r, deleted: true, etag: newEtag() });
      }
      await tx.done;
    },

    async putImage(blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const hash = await sha256Hex(bytes);
      // The same bytes are never stored twice: adding a picture that is already kept gives back the id it already has.
      const twin = await twinOf(hash, blob.type || 'image/png');
      if (twin) return twin.id;
      const id = newId();
      await storeFile(id, blob);
      urlCache.set(id, Promise.resolve(URL.createObjectURL(blob)));
      return id;
    },

    imageUrl(id) {
      let p = urlCache.get(id);
      if (!p) {
        p = db.get('images', id).then(async (row) => {
          const blob = row && (await blobOf(row));
          if (!blob) throw new Error('Image not found');
          return URL.createObjectURL(blob);
        });
        p.catch(() => urlCache.delete(id));
        urlCache.set(id, p);
      }
      return p;
    },

    async pruneImages(usedByLivePages) {
      // Trashed pages and saved versions can come back, so their images stay too.
      const used = new Set(usedByLivePages);
      for (const r of (await db.getAll('pages')).filter((p) => p.deleted)) for (const id of pageFileIds(r)) used.add(id);
      for (const s of await db.getAll('snapshots')) if (s.blocks) for (const id of fileIdsOf(s.blocks)) used.add(id); // older versions, written out in full
      for (const r of await db.getAll('historyBlocks')) for (const id of fileIdsOf([JSON.parse(r.json) as Block])) used.add(id);
      const cutoff = Date.now() - 10 * 60 * 1000;
      let n = 0;
      for (const row of await db.getAll('images')) {
        if (used.has(row.id) || row.created > cutoff) continue;
        await db.delete('images', row.id);
        await dropBlobIfUnused(row.hash);
        n++;
      }
      return n;
    },

    vectors: {
      async load(model) {
        return (await db.getAllFromIndex('embeddings', 'model', model)).map((r) => cleanVectorRow(r)).filter((r): r is VectorRow => !!r);
      },
      async put(rows) {
        const tx = db.transaction('embeddings', 'readwrite');
        for (const r of rows) {
          const c = cleanVectorRow(r);
          if (c) await tx.store.put({ ...c, k: vecId(c.model, c) } as VectorRow);
        }
        await tx.done;
      },
      async remove(model, keys) {
        const tx = db.transaction('embeddings', 'readwrite');
        for (const k of keys) await tx.store.delete(vecId(model, k));
        await tx.done;
      },
      async clear(keepModel) {
        if (keepModel === undefined) return void (await db.clear('embeddings'));
        const tx = db.transaction('embeddings', 'readwrite');
        for (const r of await tx.store.getAll()) if (r.model !== keepModel) await tx.store.delete(vecId(r.model, r));
        await tx.done;
      },
      async count(model) {
        return model === undefined ? db.count('embeddings') : db.countFromIndex('embeddings', 'model', model);
      },
    },

    async getSetting(key) {
      return (await db.get('settings', key)) ?? null;
    },
    async setSetting(key, value) {
      if (value === null) await db.delete('settings', key);
      else await db.put('settings', value, key);
    },
  };
}
