import { openDB, type DBSchema } from 'idb';
import type { Group, GroupColor, Page } from '../types';
import { cleanDate, kindOf } from '../lib/pages';
import { isBlankPage, shouldSnapshot, snapshotsToDrop } from '../lib/history';
import { newId } from '../lib/util';
import { openGraph } from '../graph/open';
import { openWasmDb } from '../graph/wasmDb';
import type { GraphMirror } from '../graph/mirror';
import {
  base64ToBytes,
  bytesToBase64,
  newEtag,
  normalizePage,
  type GroupRecord,
  type NotesStorage,
  type PageRecord,
  type SaveResult,
  type Snapshot,
  type SyncStore,
} from './types';

type PageRow = PageRecord & { rev: number; synced: string | null };
type GroupRow = GroupRecord & { synced: string | null };

interface Schema extends DBSchema {
  pages: { key: string; value: PageRow };
  groups: { key: string; value: GroupRow };
  meta: { key: string; value: { groups: Group[] } };
  images: { key: string; value: { id: string; blob: Blob; created: number } };
  settings: { key: string; value: string };
  snapshots: { key: string; value: Snapshot; indexes: { pageId: string } };
}

const rowToPage = (r: PageRow): Page => normalizePage({ ...r });
const pageRecord = (r: PageRow): PageRecord => ({
  id: r.id, etag: r.etag, deleted: r.deleted, title: r.title, groupId: r.groupId,
  tags: r.tags, blocks: r.blocks, arrows: r.arrows, drawing: r.drawing ?? null, color: r.color ?? null, kind: kindOf(r), dailyDate: cleanDate(r.dailyDate), created: r.created, updated: r.updated,
});
const groupRecord = (r: GroupRow): GroupRecord => ({
  id: r.id, etag: r.etag, deleted: r.deleted, name: r.name, color: r.color, position: r.position, parentId: r.parentId ?? null,
});

/** Browser fallback so the UI can be developed with `npm run dev` without Tauri. */
export async function createWebStorage(dbName = 'canvas-notes'): Promise<NotesStorage> {
  const db = await openDB<Schema>(dbName, 3, {
    upgrade(d, oldVersion) {
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

  // The graph lives in memory here and is rebuilt from the stored pages on every start,
  // so the dev server exercises the same code as the desktop app without a second copy of the data.
  let graph: GraphMirror | null = null;
  const mirror = (job: (g: GraphMirror) => Promise<void>) => {
    if (graph) job(graph).catch((e) => console.error('graph mirror failed', e));
  };
  // The graph only knows real pages: templates stay out of search and links.
  const livePages = async () => (await db.getAll('pages')).filter((p) => !p.deleted && kindOf(p) === 'page').map(pageRecord);
  const liveGroups = async () => (await db.getAll('groups')).filter((g) => !g.deleted).map(groupRecord);
  const mirrorPage = async (id: string) => {
    const r = await db.get('pages', id);
    if (r && kindOf(r) !== 'template') mirror((g) => g.page(pageRecord(r)));
  };
  const mirrorRemote = async (kind: 'page' | 'group', rec: PageRecord | GroupRecord) => {
    if (kind === 'page') return mirrorPage(rec.id);
    const r = rec as GroupRecord;
    mirror((g) => g.group({ id: r.id, name: r.name, color: r.color, parentId: r.parentId, deleted: r.deleted }));
    for (const p of await db.getAll('pages')) if (p.groupId === r.id && !p.deleted) await mirrorPage(p.id);
  };
  try {
    const imported = new Map<string, string>(); // per session: the in-memory graph always starts empty
    graph = await openGraph(await openWasmDb(), {
      getSetting: async (k) => (k === 'graph_imported_at' ? imported.get(k) ?? null : (await db.get('settings', k)) ?? null),
      setSetting: async (k, v) => {
        if (k === 'graph_imported_at') imported.set(k, v ?? '');
        else if (v === null) await db.delete('settings', k);
        else await db.put('settings', v, k);
      },
      deviceName: 'Browser',
      backup: async () => {}, // nothing is migrated in place: IndexedDB is not touched
      loadLegacy: async () => ({ pages: await livePages(), groups: await liveGroups() }),
      loadGroups: liveGroups,
      listEtags: async () => (await livePages()).map((p) => ({ id: p.id, etag: p.etag })),
      loadPages: async (ids) => (await livePages()).filter((p) => ids.includes(p.id)),
    });
  } catch (e) {
    console.error('graph layer unavailable', e);
  }

  /* ---- history: versions of a page, kept on this device only ---- */
  const sameContent = (a: { title: string; blocks: unknown; arrows: unknown }, b: { title: string; blocks: unknown; arrows: unknown }) =>
    a.title === b.title && JSON.stringify(a.blocks) === JSON.stringify(b.blocks) && JSON.stringify(a.arrows) === JSON.stringify(b.arrows);
  const newestFirst = async (pageId: string) => (await db.getAllFromIndex('snapshots', 'pageId', pageId)).sort((a, b) => b.taken - a.taken);

  async function takeSnapshot(pageId: string, force: boolean): Promise<boolean> {
    const now = Date.now();
    const page = await db.get('pages', pageId);
    if (!page || page.deleted || isBlankPage(page)) return false;
    const have = await newestFirst(pageId);
    if (!force && !shouldSnapshot(have[0]?.taken ?? null, now)) return false;
    if (have[0] && sameContent(have[0], page)) return false;
    await db.put('snapshots', { id: newId(), pageId, taken: now, title: page.title, blocks: page.blocks, arrows: page.arrows });
    for (const id of snapshotsToDrop([...have.map((s) => ({ id: s.id, taken: s.taken })), { id: '', taken: now }], now)) {
      if (id) await db.delete('snapshots', id);
    }
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
    if (p?.deleted) await tx.store.put({ ...p, title: '', tags: [], blocks: [], arrows: [], drawing: null, color: null, dailyDate: null, etag: newEtag(), rev: p.rev + 1 });
    await tx.done;
    for (const s of await db.getAllFromIndex('snapshots', 'pageId', id)) await db.delete('snapshots', s.id);
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
      await mirrorRemote(kind, rec as PageRecord | GroupRecord);
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
        await mirrorRemote(kind, rec as PageRecord);
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
      await mirrorRemote(kind, rec as GroupRecord);
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
      await mirrorPage(r.id);
    },
    async listImageIds() {
      return (await db.getAllKeys('images')) as string[];
    },
    async readImage(id) {
      const row = await db.get('images', id);
      if (!row) return null;
      return { id, mime: row.blob.type || 'image/png', data: bytesToBase64(new Uint8Array(await row.blob.arrayBuffer())) };
    },
    async writeImage(img) {
      if (await db.get('images', img.id)) return;
      await db.put('images', { id: img.id, blob: new Blob([base64ToBytes(img.data)], { type: img.mime }), created: Date.now() });
    },
  };

  return {
    kind: 'browser',
    sync,
    graph,

    async location() {
      return 'this browser (IndexedDB)';
    },

    async loadAll() {
      const pages = (await db.getAll('pages')).filter((p) => !p.deleted).map(rowToPage);
      const groups = (await db.getAll('groups'))
        .filter((g) => !g.deleted)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((g) => ({ id: g.id, name: g.name, color: g.color as GroupColor, parentId: g.parentId ?? null }));
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
        id: page.id, title: page.title, groupId: page.groupId, tags: page.tags, blocks: page.blocks, arrows: page.arrows, drawing: page.drawing ?? null, color: page.color ?? null, kind: kindOf(page), dailyDate: cleanDate(page.dailyDate),
        created: page.created, updated: page.updated, rev, etag: newEtag(), synced: existing?.synced ?? null, deleted: false,
      });
      await tx.done;
      await mirrorPage(page.id);
      return { ok: true, rev };
    },

    async deletePage(id) {
      const tx = db.transaction('pages', 'readwrite');
      const p = await tx.store.get(id);
      if (p && !p.deleted) await tx.store.put({ ...p, deleted: true, etag: newEtag(), updated: Date.now(), rev: p.rev + 1 });
      await tx.done;
      mirror((g) => g.removePage(id));
    },

    async listTrash() {
      return (await db.getAll('pages'))
        .filter((p) => p.deleted && kindOf(p) === 'page' && !isBlankPage(p))
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
      return old.length;
    },

    listSnapshots: newestFirst,

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
        if (cur && !cur.deleted && cur.name === g.name && cur.color === g.color && cur.position === i && (cur.parentId ?? null) === parentId) continue;
        await tx.store.put({ id: g.id, name: g.name, color: g.color, position: i, parentId, etag: newEtag(), synced: cur?.synced ?? null, deleted: false });
      }
      for (const r of await tx.store.getAll()) {
        if (!keep.has(r.id) && !r.deleted) await tx.store.put({ ...r, deleted: true, etag: newEtag() });
      }
      await tx.done;
      mirror((g) => g.groups(groups.map((x) => ({ id: x.id, name: x.name, color: x.color, parentId: x.parentId }))));
    },

    async putImage(blob) {
      const id = newId();
      await db.put('images', { id, blob, created: Date.now() });
      urlCache.set(id, Promise.resolve(URL.createObjectURL(blob)));
      return id;
    },

    imageUrl(id) {
      let p = urlCache.get(id);
      if (!p) {
        p = db.get('images', id).then((row) => {
          if (!row) throw new Error('Image not found');
          return URL.createObjectURL(row.blob);
        });
        p.catch(() => urlCache.delete(id));
        urlCache.set(id, p);
      }
      return p;
    },

    async pruneImages(usedByLivePages) {
      // Trashed pages and saved versions can come back, so their images stay too.
      const used = new Set(usedByLivePages);
      const keep = [...(await db.getAll('pages')).filter((p) => p.deleted), ...(await db.getAll('snapshots'))];
      for (const r of keep) for (const b of r.blocks) if (b.type === 'image') used.add(b.imageId);
      const cutoff = Date.now() - 10 * 60 * 1000;
      let n = 0;
      for (const row of await db.getAll('images')) {
        if (used.has(row.id) || row.created > cutoff) continue;
        await db.delete('images', row.id);
        n++;
      }
      return n;
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
