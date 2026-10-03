import { openDB, type DBSchema } from 'idb';
import type { Group, GroupColor, Page } from '../types';
import { newId } from '../lib/util';
import {
  base64ToBytes,
  bytesToBase64,
  newEtag,
  normalizePage,
  type GroupRecord,
  type NotesStorage,
  type PageRecord,
  type SaveResult,
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
}

const rowToPage = (r: PageRow): Page => normalizePage({ ...r });
const pageRecord = (r: PageRow): PageRecord => ({
  id: r.id, etag: r.etag, deleted: r.deleted, title: r.title, groupId: r.groupId,
  tags: r.tags, blocks: r.blocks, created: r.created, updated: r.updated,
});
const groupRecord = (r: GroupRow): GroupRecord => ({
  id: r.id, etag: r.etag, deleted: r.deleted, name: r.name, color: r.color, position: r.position, parentId: r.parentId ?? null,
});

/** Browser fallback so the UI can be developed with `npm run dev` without Tauri. */
export async function createWebStorage(dbName = 'canvas-notes'): Promise<NotesStorage> {
  const db = await openDB<Schema>(dbName, 2, {
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
        const tx = db.transaction('pages', 'readwrite');
        const cur = await tx.store.get(rec.id);
        await tx.store.put({ ...(rec as PageRecord), rev: (cur?.rev ?? 0) + 1, synced: rec.etag });
        await tx.done;
      } else {
        await db.put('groups', { ...(rec as GroupRecord), synced: rec.etag });
      }
    },
    async applyRemoteIf(kind, rec, base) {
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
      const tx = db.transaction('pages', 'readwrite');
      const existing = await tx.store.get(page.id);
      if (existing && !existing.deleted && existing.rev !== page.rev) {
        await tx.done;
        return { ok: false, reason: 'conflict' };
      }
      // A deleted page that is edited again comes back.
      const rev = existing ? existing.rev + 1 : 1;
      await tx.store.put({
        id: page.id, title: page.title, groupId: page.groupId, tags: page.tags, blocks: page.blocks,
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

    async pruneImages(used) {
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
