import Database from '@tauri-apps/plugin-sql';
import { BaseDirectory, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { appConfigDir } from '@tauri-apps/api/path';
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
  type SyncKind,
  type SyncRecord,
  type SyncStore,
} from './types';

// The SQL plugin keeps `sqlite:` databases in the app config directory
// (~/.config/<identifier>/ on Linux, the app's private storage on Android).
// Images live beside it in images/.
const DB_URL = 'sqlite:canvas-notes.db';
const IMG_DIR = 'images';
const fsOpts = { baseDir: BaseDirectory.AppConfig };

type PageRow = {
  id: string;
  title: string;
  group_id: string | null;
  tags: string;
  blocks: string;
  created: number;
  updated: number;
  rev: number;
  etag: string;
  synced: string | null;
  deleted: number;
};
type GroupRow = { id: string; name: string; color: string; position: number; etag: string; synced: string | null; deleted: number; parent_id: string | null };
type ImageRow = { id: string; file: string; mime: string; created: number };

/** Each entry runs once, in order; progress is kept in SQLite's user_version. */
const MIGRATIONS: string[][] = [
  // v1: pages, groups, images
  [
    `CREATE TABLE IF NOT EXISTS pages (
       id TEXT PRIMARY KEY,
       title TEXT NOT NULL DEFAULT '',
       group_id TEXT,
       tags TEXT NOT NULL DEFAULT '[]',
       blocks TEXT NOT NULL DEFAULT '[]',
       created INTEGER NOT NULL,
       updated INTEGER NOT NULL,
       rev INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE TABLE IF NOT EXISTS page_groups (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       color TEXT NOT NULL,
       position INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE TABLE IF NOT EXISTS images (
       id TEXT PRIMARY KEY,
       file TEXT NOT NULL,
       mime TEXT NOT NULL,
       created INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS pages_group ON pages(group_id)`,
  ],
  // v2: change tracking for Wi-Fi sync, and settings
  [
    `ALTER TABLE pages ADD COLUMN etag TEXT`,
    `ALTER TABLE pages ADD COLUMN synced TEXT`,
    `ALTER TABLE pages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`,
    `UPDATE pages SET etag = lower(hex(randomblob(9))) WHERE etag IS NULL`,
    `ALTER TABLE page_groups ADD COLUMN etag TEXT`,
    `ALTER TABLE page_groups ADD COLUMN synced TEXT`,
    `ALTER TABLE page_groups ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`,
    `UPDATE page_groups SET etag = lower(hex(randomblob(9))) WHERE etag IS NULL`,
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ],
  // v3: subgroups
  [`ALTER TABLE page_groups ADD COLUMN parent_id TEXT`],
];

async function migrate(db: Database) {
  const rows = await db.select<{ user_version: number }[]>('PRAGMA user_version');
  let version = rows[0]?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    for (const sql of MIGRATIONS[version]) {
      try {
        await db.execute(sql);
      } catch (e) {
        // A migration interrupted half-way may already have added this column.
        if (!String(e).includes('duplicate column')) throw e;
      }
    }
    version += 1;
    await db.execute(`PRAGMA user_version = ${version}`);
  }
}

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function rowToPage(r: PageRow): Page {
  return normalizePage({
    id: r.id,
    title: r.title,
    groupId: r.group_id,
    tags: parseJson(r.tags, []),
    blocks: parseJson(r.blocks, []),
    created: r.created,
    updated: r.updated,
    rev: r.rev,
  });
}

function rowToPageRecord(r: PageRow): PageRecord {
  return {
    id: r.id,
    etag: r.etag,
    deleted: !!r.deleted,
    title: r.title,
    groupId: r.group_id,
    tags: parseJson(r.tags, []),
    blocks: parseJson(r.blocks, []),
    created: r.created,
    updated: r.updated,
  };
}

function rowToGroupRecord(r: GroupRow): GroupRecord {
  return { id: r.id, etag: r.etag, deleted: !!r.deleted, name: r.name, color: r.color as GroupColor, position: r.position, parentId: r.parent_id ?? null };
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

const TABLE: Record<SyncKind, string> = { page: 'pages', group: 'page_groups' };

export async function createTauriStorage(): Promise<NotesStorage> {
  const db = await Database.load(DB_URL);
  await migrate(db);
  await mkdir(IMG_DIR, { ...fsOpts, recursive: true });
  const urlCache = new Map<string, Promise<string>>();

  async function selectIn<T>(sql: (placeholders: string) => string, ids: string[]): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const ph = chunk.map((_, j) => `$${j + 1}`).join(', ');
      out.push(...(await db.select<T[]>(sql(ph), chunk)));
    }
    return out;
  }

  async function currentEtag(kind: SyncKind, id: string): Promise<string | null> {
    const rows = await db.select<{ etag: string }[]>(`SELECT etag FROM ${TABLE[kind]} WHERE id = $1`, [id]);
    return rows[0]?.etag ?? null;
  }

  /** Values in the order used by the page INSERT/UPDATE statements below. */
  const pageValues = (r: PageRecord) => [r.id, r.title, r.groupId, JSON.stringify(r.tags), JSON.stringify(r.blocks), r.created, r.updated, r.etag, r.deleted ? 1 : 0];
  const groupValues = (r: GroupRecord) => [r.id, r.name, r.color, r.position, r.etag, r.deleted ? 1 : 0, r.parentId ?? null];

  const sync: SyncStore = {
    async listMeta(kind) {
      const rows = await db.select<{ id: string; etag: string; synced: string | null; deleted: number }[]>(
        `SELECT id, etag, synced, deleted FROM ${TABLE[kind]}`,
      );
      return rows.map((r) => ({ id: r.id, etag: r.etag, synced: r.synced, deleted: !!r.deleted }));
    },

    async getRecords(kind, ids) {
      if (kind === 'page') {
        const rows = await selectIn<PageRow>((ph) => `SELECT * FROM pages WHERE id IN (${ph})`, ids);
        return rows.map(rowToPageRecord);
      }
      const rows = await selectIn<GroupRow>((ph) => `SELECT * FROM page_groups WHERE id IN (${ph})`, ids);
      return rows.map(rowToGroupRecord);
    },

    async applyRemote(kind, rec) {
      if (kind === 'page') {
        await db.execute(
          `INSERT INTO pages (id, title, group_id, tags, blocks, created, updated, etag, deleted, rev, synced)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $8)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title, group_id = excluded.group_id, tags = excluded.tags, blocks = excluded.blocks,
             created = excluded.created, updated = excluded.updated, etag = excluded.etag, deleted = excluded.deleted,
             synced = excluded.etag, rev = pages.rev + 1`,
          pageValues(rec as PageRecord),
        );
      } else {
        await db.execute(
          `INSERT INTO page_groups (id, name, color, position, etag, deleted, parent_id, synced)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $5)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, color = excluded.color, position = excluded.position,
             etag = excluded.etag, deleted = excluded.deleted, parent_id = excluded.parent_id, synced = excluded.etag`,
          groupValues(rec as GroupRecord),
        );
      }
    },

    async applyRemoteIf(kind, rec, base) {
      let affected: number;
      if (base === null) {
        if (kind === 'page') {
          affected = (
            await db.execute(
              `INSERT INTO pages (id, title, group_id, tags, blocks, created, updated, etag, deleted, rev, synced)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $8) ON CONFLICT(id) DO NOTHING`,
              pageValues(rec as PageRecord),
            )
          ).rowsAffected;
        } else {
          affected = (
            await db.execute(
              `INSERT INTO page_groups (id, name, color, position, etag, deleted, parent_id, synced)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $5) ON CONFLICT(id) DO NOTHING`,
              groupValues(rec as GroupRecord),
            )
          ).rowsAffected;
        }
      } else if (kind === 'page') {
        affected = (
          await db.execute(
            `UPDATE pages SET title = $2, group_id = $3, tags = $4, blocks = $5, created = $6, updated = $7,
               etag = $8, deleted = $9, synced = $8, rev = rev + 1
             WHERE id = $1 AND etag = $10`,
            [...pageValues(rec as PageRecord), base],
          )
        ).rowsAffected;
      } else {
        affected = (
          await db.execute(
            `UPDATE page_groups SET name = $2, color = $3, position = $4, etag = $5, deleted = $6, parent_id = $7, synced = $5
             WHERE id = $1 AND etag = $8`,
            [...groupValues(rec as GroupRecord), base],
          )
        ).rowsAffected;
      }
      // A retried request whose first attempt already landed also counts as accepted.
      return affected > 0 || (await currentEtag(kind, rec.id)) === rec.etag;
    },

    async markSynced(kind, id, etag) {
      await db.execute(`UPDATE ${TABLE[kind]} SET synced = $2 WHERE id = $1`, [id, etag]);
    },

    async insertLocalPage(r) {
      await db.execute(
        `INSERT INTO pages (id, title, group_id, tags, blocks, created, updated, etag, deleted, rev, synced)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 1, NULL)`,
        [r.id, r.title, r.groupId, JSON.stringify(r.tags), JSON.stringify(r.blocks), r.created, r.updated, newEtag()],
      );
    },

    async listImageIds() {
      return (await db.select<{ id: string }[]>('SELECT id FROM images')).map((r) => r.id);
    },

    async readImage(id) {
      const rows = await db.select<ImageRow[]>('SELECT * FROM images WHERE id = $1', [id]);
      if (!rows[0]) return null;
      try {
        const bytes = await readFile(`${IMG_DIR}/${rows[0].file}`, fsOpts);
        return { id, mime: rows[0].mime, data: bytesToBase64(bytes) };
      } catch {
        return null;
      }
    },

    async writeImage(img) {
      const exists = await db.select<{ id: string }[]>('SELECT id FROM images WHERE id = $1', [img.id]);
      if (exists.length) return;
      const file = `${img.id}.${EXT[img.mime] ?? 'bin'}`;
      await writeFile(`${IMG_DIR}/${file}`, base64ToBytes(img.data), fsOpts);
      await db.execute('INSERT OR IGNORE INTO images (id, file, mime, created) VALUES ($1, $2, $3, $4)', [img.id, file, img.mime, Date.now()]);
    },
  };

  return {
    kind: 'desktop',
    sync,

    async location() {
      return appConfigDir();
    },

    async loadAll() {
      const pageRows = await db.select<PageRow[]>('SELECT * FROM pages WHERE deleted = 0');
      const groupRows = await db.select<GroupRow[]>('SELECT * FROM page_groups WHERE deleted = 0 ORDER BY position, name');
      return {
        pages: pageRows.map(rowToPage),
        groups: groupRows.map((g) => ({ id: g.id, name: g.name, color: g.color as GroupColor, parentId: g.parent_id ?? null })),
      };
    },

    async loadPage(id) {
      const rows = await db.select<PageRow[]>('SELECT * FROM pages WHERE id = $1 AND deleted = 0', [id]);
      return rows[0] ? rowToPage(rows[0]) : null;
    },

    async savePage(page): Promise<SaveResult> {
      const tags = JSON.stringify(page.tags);
      const blocks = JSON.stringify(page.blocks);
      const etag = newEtag();
      const upd = await db.execute(
        `UPDATE pages SET title = $1, group_id = $2, tags = $3, blocks = $4, updated = $5, etag = $8, rev = rev + 1
         WHERE id = $6 AND rev = $7 AND deleted = 0`,
        [page.title, page.groupId, tags, blocks, page.updated, page.id, page.rev, etag],
      );
      if (upd.rowsAffected > 0) return { ok: true, rev: page.rev + 1 };

      const existing = await db.select<{ rev: number; deleted: number }[]>('SELECT rev, deleted FROM pages WHERE id = $1', [page.id]);
      if (existing.length && !existing[0].deleted) return { ok: false, reason: 'conflict' };
      if (existing.length) {
        // Deleted here or on the other device, but edited again: the edit brings the page back.
        await db.execute(
          `UPDATE pages SET title = $1, group_id = $2, tags = $3, blocks = $4, updated = $5, etag = $6, deleted = 0, rev = rev + 1
           WHERE id = $7`,
          [page.title, page.groupId, tags, blocks, page.updated, etag, page.id],
        );
        const r = await db.select<{ rev: number }[]>('SELECT rev FROM pages WHERE id = $1', [page.id]);
        return { ok: true, rev: r[0]?.rev ?? existing[0].rev + 1 };
      }
      await db.execute(
        `INSERT INTO pages (id, title, group_id, tags, blocks, created, updated, rev, etag, synced, deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, NULL, 0)`,
        [page.id, page.title, page.groupId, tags, blocks, page.created, page.updated, etag],
      );
      return { ok: true, rev: 1 };
    },

    async deletePage(id) {
      await db.execute('UPDATE pages SET deleted = 1, etag = $2, updated = $3, rev = rev + 1 WHERE id = $1 AND deleted = 0', [
        id,
        newEtag(),
        Date.now(),
      ]);
    },

    async saveGroups(groups: Group[]) {
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        // Only rows that really changed get a new etag, so sync sends just those.
        const upd = await db.execute(
          `UPDATE page_groups SET name = $2, color = $3, position = $4, parent_id = $6, deleted = 0, etag = $5
           WHERE id = $1 AND (name IS NOT $2 OR color IS NOT $3 OR position IS NOT $4 OR parent_id IS NOT $6 OR deleted = 1)`,
          [g.id, g.name, g.color, i, newEtag(), g.parentId ?? null],
        );
        if (upd.rowsAffected === 0) {
          await db.execute(
            `INSERT INTO page_groups (id, name, color, position, etag, parent_id, synced, deleted)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, 0) ON CONFLICT(id) DO NOTHING`,
            [g.id, g.name, g.color, i, newEtag(), g.parentId ?? null],
          );
        }
      }
      const keep = new Set(groups.map((g) => g.id));
      const rows = await db.select<{ id: string }[]>('SELECT id FROM page_groups WHERE deleted = 0');
      for (const r of rows) {
        if (!keep.has(r.id)) await db.execute('UPDATE page_groups SET deleted = 1, etag = $2 WHERE id = $1', [r.id, newEtag()]);
      }
    },

    async putImage(blob) {
      const id = newId();
      const mime = blob.type || 'image/png';
      const file = `${id}.${EXT[mime] ?? 'bin'}`;
      await writeFile(`${IMG_DIR}/${file}`, new Uint8Array(await blob.arrayBuffer()), fsOpts);
      await db.execute('INSERT INTO images (id, file, mime, created) VALUES ($1, $2, $3, $4)', [id, file, mime, Date.now()]);
      urlCache.set(id, Promise.resolve(URL.createObjectURL(blob)));
      return id;
    },

    imageUrl(id) {
      let p = urlCache.get(id);
      if (!p) {
        p = (async () => {
          const rows = await db.select<ImageRow[]>('SELECT * FROM images WHERE id = $1', [id]);
          if (!rows[0]) throw new Error('Image not found');
          const bytes = await readFile(`${IMG_DIR}/${rows[0].file}`, fsOpts);
          return URL.createObjectURL(new Blob([bytes], { type: rows[0].mime }));
        })();
        p.catch(() => urlCache.delete(id));
        urlCache.set(id, p);
      }
      return p;
    },

    async pruneImages(used) {
      const rows = await db.select<ImageRow[]>('SELECT * FROM images');
      const cutoff = Date.now() - 10 * 60 * 1000;
      let n = 0;
      for (const r of rows) {
        if (used.has(r.id) || r.created > cutoff) continue;
        try {
          await remove(`${IMG_DIR}/${r.file}`, fsOpts);
        } catch {
          /* already gone */
        }
        await db.execute('DELETE FROM images WHERE id = $1', [r.id]);
        n++;
      }
      return n;
    },

    async getSetting(key) {
      const rows = await db.select<{ value: string }[]>('SELECT value FROM settings WHERE key = $1', [key]);
      return rows[0]?.value ?? null;
    },

    async setSetting(key, value) {
      if (value === null) await db.execute('DELETE FROM settings WHERE key = $1', [key]);
      else
        await db.execute('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
          key,
          value,
        ]);
    },
  };
}

export type { SyncRecord };
