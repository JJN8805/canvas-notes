import Database from '@tauri-apps/plugin-sql';
import { BaseDirectory, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { appConfigDir, join } from '@tauri-apps/api/path';
import type { Block, Group, GroupColor, Page } from '../types';
import { cleanColor } from '../lib/colors';
import { cleanSheet } from '../lib/sheet';
import { cleanDate, kindOf } from '../lib/pages';
import { shouldSnapshot, snapshotsToDrop } from '../lib/history';
import { newId } from '../lib/util';
import { assertSafeImage, FILE_EXT } from './validate';
import { fileIdsOf } from '../lib/files';
import { pluginDb } from '../graph/db';
import { GRAPH_SCHEMA } from '../graph/schema';
import { openGraph } from '../graph/open';
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
  arrows: string;
  drawing: string;
  color: string | null;
  kind: string | null;
  daily_date: string | null;
  sheet: string;
  created: number;
  updated: number;
  rev: number;
  etag: string;
  synced: string | null;
  deleted: number;
};
type GroupRow = { id: string; name: string; color: string; position: number; etag: string; synced: string | null; deleted: number; parent_id: string | null };
type SnapshotRow = { id: string; page_id: string; taken: number; title: string; blocks: string; arrows: string };
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
  // v4: connector arrows
  [`ALTER TABLE pages ADD COLUMN arrows TEXT NOT NULL DEFAULT '[]'`],
  // v5: graph layer (nodes, edges, blocks, connectors, assets, search). Filled by graph/open.ts.
  GRAPH_SCHEMA,
  // v6: page history. Local to this device, never synced.
  [
    `CREATE TABLE IF NOT EXISTS page_snapshots (
       id TEXT PRIMARY KEY,
       page_id TEXT NOT NULL,
       taken INTEGER NOT NULL,
       title TEXT NOT NULL DEFAULT '',
       blocks TEXT NOT NULL,
       arrows TEXT NOT NULL DEFAULT '[]'
     )`,
    `CREATE INDEX IF NOT EXISTS page_snapshots_page ON page_snapshots(page_id, taken)`,
  ],
  // v7: ink drawn over the whole page (JSON, '' = none)
  [`ALTER TABLE pages ADD COLUMN drawing TEXT NOT NULL DEFAULT ''`],
  // v8: colour of the page's card in the library (NULL = none)
  [`ALTER TABLE pages ADD COLUMN color TEXT`],
  // v9: templates live in the pages table (kind), and a daily page records its date
  [
    `ALTER TABLE pages ADD COLUMN kind TEXT NOT NULL DEFAULT 'page'`,
    `ALTER TABLE pages ADD COLUMN daily_date TEXT`,
    `CREATE INDEX IF NOT EXISTS pages_daily ON pages(daily_date)`,
  ],
  // v10: a finite page's edges (JSON, '' = an infinite page, which is every page made before this)
  [`ALTER TABLE pages ADD COLUMN sheet TEXT NOT NULL DEFAULT ''`],
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
    arrows: parseJson(r.arrows, []),
    drawing: r.drawing ? parseJson(r.drawing, null) : null,
    color: cleanColor(r.color),
    kind: kindOf({ kind: r.kind }),
    dailyDate: cleanDate(r.daily_date),
    sheet: r.sheet ? cleanSheet(parseJson(r.sheet, null)) : null,
    created: r.created,
    updated: r.updated,
    rev: r.rev,
  });
}

/** A sheet as stored: JSON, or '' for an infinite page. */
const sheetJson = (s: unknown) => {
  const c = cleanSheet(s);
  return c ? JSON.stringify(c) : '';
};

function rowToPageRecord(r: PageRow): PageRecord {
  return {
    id: r.id,
    etag: r.etag,
    deleted: !!r.deleted,
    title: r.title,
    groupId: r.group_id,
    tags: parseJson(r.tags, []),
    blocks: parseJson(r.blocks, []),
    arrows: parseJson(r.arrows, []),
    drawing: r.drawing ? parseJson(r.drawing, null) : null,
    color: cleanColor(r.color),
    kind: kindOf({ kind: r.kind }),
    dailyDate: cleanDate(r.daily_date),
    sheet: r.sheet ? cleanSheet(parseJson(r.sheet, null)) : null,
    created: r.created,
    updated: r.updated,
  };
}

function rowToGroupRecord(r: GroupRow): GroupRecord {
  return { id: r.id, etag: r.etag, deleted: !!r.deleted, name: r.name, color: r.color as GroupColor, position: r.position, parentId: r.parent_id ?? null };
}

const EXT = FILE_EXT;

/** A consistent copy of the whole database (VACUUM INTO also folds in the WAL file). */
async function backupDatabase(db: Database) {
  await mkdir('backups', { ...fsOpts, recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = await join(await appConfigDir(), 'backups', `before-graph-${stamp}.db`);
  await db.execute('VACUUM INTO $1', [file]);
}

const TABLE: Record<SyncKind, string> = { page: 'pages', group: 'page_groups' };

export async function createTauriStorage(): Promise<NotesStorage> {
  const db = await Database.load(DB_URL);
  await migrate(db);
  await mkdir(IMG_DIR, { ...fsOpts, recursive: true });
  const urlCache = new Map<string, Promise<string>>();
  let graph: GraphMirror | null = null;

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

  /** Drops history this page no longer needs (see `snapshotsToDrop`). */
  async function thinSnapshots(pageId: string) {
    const rows = await db.select<{ id: string; taken: number }[]>('SELECT id, taken FROM page_snapshots WHERE page_id = $1', [pageId]);
    for (const id of snapshotsToDrop(rows, Date.now())) await db.execute('DELETE FROM page_snapshots WHERE id = $1', [id]);
  }

  /**
   * Copies the page as stored now into page_snapshots (one statement, so no content passes through JS).
   * Skips blank pages and a copy of the newest snapshot. Without `force`, at most one an hour.
   */
  async function takeSnapshot(pageId: string, force: boolean): Promise<boolean> {
    const now = Date.now();
    if (!force) {
      const last = await db.select<{ t: number | null }[]>('SELECT MAX(taken) AS t FROM page_snapshots WHERE page_id = $1', [pageId]);
      if (!shouldSnapshot(last[0]?.t ?? null, now)) return false;
    }
    const r = await db.execute(
      `INSERT INTO page_snapshots (id, page_id, taken, title, blocks, arrows)
       SELECT $1, p.id, $2, p.title, p.blocks, p.arrows FROM pages p
       WHERE p.id = $3 AND p.deleted = 0 AND NOT (p.title = '' AND p.blocks = '[]' AND p.arrows = '[]')
         AND NOT EXISTS (
           SELECT 1 FROM page_snapshots s WHERE s.page_id = p.id AND s.title = p.title AND s.blocks = p.blocks AND s.arrows = p.arrows
             AND s.taken = (SELECT MAX(taken) FROM page_snapshots WHERE page_id = p.id))`,
      [newId(), now, pageId],
    );
    if (r.rowsAffected === 0) return false;
    await thinSnapshots(pageId);
    return true;
  }
  /** A history problem must never fail a save or a sync. */
  const safeSnapshot = (pageId: string, force: boolean) => takeSnapshot(pageId, force).catch((e) => void console.error('history snapshot failed', e));

  /** Before a synced copy replaces a live local page with different content, keep the local version. */
  async function snapshotIfReplacing(rec: PageRecord) {
    const cur = await db.select<{ title: string; blocks: string; arrows: string }[]>('SELECT title, blocks, arrows FROM pages WHERE id = $1 AND deleted = 0', [rec.id]);
    if (!cur[0]) return;
    if (cur[0].title === rec.title && cur[0].blocks === JSON.stringify(rec.blocks) && cur[0].arrows === JSON.stringify(rec.arrows ?? [])) return;
    await safeSnapshot(rec.id, true);
  }

  async function purgePage(id: string) {
    await db.execute(
      `UPDATE pages SET title = '', tags = '[]', blocks = '[]', arrows = '[]', drawing = '', color = NULL, daily_date = NULL, sheet = '', etag = $2, rev = rev + 1 WHERE id = $1 AND deleted = 1`,
      [id, newEtag()],
    );
    await db.execute('DELETE FROM page_snapshots WHERE page_id = $1', [id]);
  }

  /** Values in the order used by the page INSERT/UPDATE statements below. */
  const pageValues = (r: PageRecord) => [
    r.id, r.title, r.groupId, JSON.stringify(r.tags), JSON.stringify(r.blocks), JSON.stringify(r.arrows ?? []),
    r.created, r.updated, r.etag, r.deleted ? 1 : 0, r.drawing ? JSON.stringify(r.drawing) : '', r.color ?? null,
    kindOf(r), cleanDate(r.dailyDate), sheetJson(r.sheet),
  ];
  const groupValues = (r: GroupRecord) => [r.id, r.name, r.color, r.position, r.etag, r.deleted ? 1 : 0, r.parentId ?? null];

  /** Keeps the graph tables in step. The graph is a copy for now, so a failure here must never fail the save. */
  const mirror = (job: (g: GraphMirror) => Promise<void>) => {
    if (graph) job(graph).catch((e) => console.error('graph mirror failed', e));
  };
  const mirrorPages = async (ids: string[]) => {
    try {
      for (const r of await selectIn<PageRow>((ph) => `SELECT * FROM pages WHERE id IN (${ph})`, ids)) {
        const rec = rowToPageRecord(r);
        if (rec.kind !== 'page') continue; // templates and cards stay out of the graph, so out of search and links
        mirror((g) => g.page(rec));
      }
    } catch (e) {
      console.error('graph mirror failed', e);
    }
  };
  const mirrorRemote = async (kind: SyncKind, rec: SyncRecord) => {
    if (kind === 'page') return mirrorPages([rec.id]);
    const r = rec as GroupRecord;
    mirror((g) => g.group({ id: r.id, name: r.name, color: r.color, parentId: r.parentId, deleted: r.deleted }));
    // Pages may have arrived before their group did: give them their IN_GROUP edge now.
    const members = await db.select<{ id: string }[]>('SELECT id FROM pages WHERE group_id = $1 AND deleted = 0', [r.id]).catch(() => []);
    if (members.length) await mirrorPages(members.map((m) => m.id));
  };

  const toLegacyGroup = (g: GroupRow) => ({ id: g.id, name: g.name, color: g.color, parentId: g.parent_id ?? null });
  try {
    graph = await openGraph(pluginDb(db), {
      getSetting: async (key) => (await db.select<{ value: string }[]>('SELECT value FROM settings WHERE key = $1', [key]))[0]?.value ?? null,
      setSetting: async (key, value) => void (await db.execute('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value])),
      deviceName: /android/i.test(globalThis.navigator?.userAgent ?? '') ? 'Phone' : 'Laptop',
      backup: () => backupDatabase(db),
      loadLegacy: async () => ({
        pages: (await db.select<PageRow[]>("SELECT * FROM pages WHERE deleted = 0 AND kind = 'page'")).map(rowToPageRecord),
        groups: (await db.select<GroupRow[]>('SELECT * FROM page_groups WHERE deleted = 0')).map(toLegacyGroup),
      }),
      loadGroups: async () => (await db.select<GroupRow[]>('SELECT * FROM page_groups WHERE deleted = 0')).map(toLegacyGroup),
      listEtags: () => db.select<{ id: string; etag: string }[]>("SELECT id, etag FROM pages WHERE deleted = 0 AND kind = 'page'"),
      loadPages: async (ids) => (await selectIn<PageRow>((ph) => `SELECT * FROM pages WHERE id IN (${ph})`, ids)).map(rowToPageRecord),
    });
  } catch (e) {
    // The graph is a copy of the pages for now, so the app still works without it.
    console.error('graph layer unavailable', e);
  }

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
        await snapshotIfReplacing(rec as PageRecord);
        await db.execute(
          `INSERT INTO pages (id, title, group_id, tags, blocks, arrows, created, updated, etag, deleted, drawing, color, kind, daily_date, sheet, rev, synced)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1, $9)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title, group_id = excluded.group_id, tags = excluded.tags, blocks = excluded.blocks, arrows = excluded.arrows, drawing = excluded.drawing, color = excluded.color, kind = excluded.kind, daily_date = excluded.daily_date, sheet = excluded.sheet,
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
      await mirrorRemote(kind, rec);
    },

    async applyRemoteIf(kind, rec, base) {
      if (kind === 'page' && base !== null) await snapshotIfReplacing(rec as PageRecord);
      let affected: number;
      if (base === null) {
        if (kind === 'page') {
          affected = (
            await db.execute(
              `INSERT INTO pages (id, title, group_id, tags, blocks, arrows, created, updated, etag, deleted, drawing, color, kind, daily_date, sheet, rev, synced)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1, $9) ON CONFLICT(id) DO NOTHING`,
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
            `UPDATE pages SET title = $2, group_id = $3, tags = $4, blocks = $5, arrows = $6, created = $7, updated = $8,
               etag = $9, deleted = $10, drawing = $11, color = $12, kind = $13, daily_date = $14, sheet = $15, synced = $9, rev = rev + 1
             WHERE id = $1 AND etag = $16`,
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
      const accepted = affected > 0 || (await currentEtag(kind, rec.id)) === rec.etag;
      if (accepted) await mirrorRemote(kind, rec);
      return accepted;
    },

    async markSynced(kind, id, etag) {
      await db.execute(`UPDATE ${TABLE[kind]} SET synced = $2 WHERE id = $1`, [id, etag]);
    },

    async insertLocalPage(r) {
      await db.execute(
        `INSERT INTO pages (id, title, group_id, tags, blocks, arrows, created, updated, etag, deleted, drawing, color, kind, daily_date, sheet, rev, synced)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, $12, $13, $14, 1, NULL)`,
        [r.id, r.title, r.groupId, JSON.stringify(r.tags), JSON.stringify(r.blocks), JSON.stringify(r.arrows ?? []), r.created, r.updated, newEtag(), r.drawing ? JSON.stringify(r.drawing) : '', r.color ?? null, kindOf(r), cleanDate(r.dailyDate), sheetJson(r.sheet)],
      );
      await mirrorPages([r.id]);
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
      // The id becomes a file name and comes from another device or a backup file: never trust it.
      assertSafeImage(img);
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
    graph,

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
      const arrows = JSON.stringify(page.arrows);
      const drawing = page.drawing ? JSON.stringify(page.drawing) : '';
      const color = page.color ?? null;
      const kind = kindOf(page);
      const dailyDate = cleanDate(page.dailyDate);
      const sheet = sheetJson(page.sheet);
      const etag = newEtag();
      await safeSnapshot(page.id, false); // the page as it was before this save
      const upd = await db.execute(
        `UPDATE pages SET title = $1, group_id = $2, tags = $3, blocks = $4, arrows = $5, updated = $6, etag = $9, drawing = $10, color = $11, kind = $12, daily_date = $13, sheet = $14, rev = rev + 1
         WHERE id = $7 AND rev = $8 AND deleted = 0`,
        [page.title, page.groupId, tags, blocks, arrows, page.updated, page.id, page.rev, etag, drawing, color, kind, dailyDate, sheet],
      );
      if (upd.rowsAffected > 0) {
        await mirrorPages([page.id]);
        return { ok: true, rev: page.rev + 1 };
      }

      const existing = await db.select<{ rev: number; deleted: number }[]>('SELECT rev, deleted FROM pages WHERE id = $1', [page.id]);
      if (existing.length && !existing[0].deleted) return { ok: false, reason: 'conflict' };
      if (existing.length) {
        // Deleted here or on the other device, but edited again: the edit brings the page back.
        await db.execute(
          `UPDATE pages SET title = $1, group_id = $2, tags = $3, blocks = $4, arrows = $5, updated = $6, etag = $7, deleted = 0, drawing = $9, color = $10, kind = $11, daily_date = $12, sheet = $13, rev = rev + 1
           WHERE id = $8`,
          [page.title, page.groupId, tags, blocks, arrows, page.updated, etag, page.id, drawing, color, kind, dailyDate, sheet],
        );
        const r = await db.select<{ rev: number }[]>('SELECT rev FROM pages WHERE id = $1', [page.id]);
        await mirrorPages([page.id]);
        return { ok: true, rev: r[0]?.rev ?? existing[0].rev + 1 };
      }
      await db.execute(
        `INSERT INTO pages (id, title, group_id, tags, blocks, arrows, created, updated, rev, etag, synced, deleted, drawing, color, kind, daily_date, sheet)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, NULL, 0, $10, $11, $12, $13, $14)`,
        [page.id, page.title, page.groupId, tags, blocks, arrows, page.created, page.updated, etag, drawing, color, kind, dailyDate, sheet],
      );
      await mirrorPages([page.id]);
      return { ok: true, rev: 1 };
    },

    async deletePage(id) {
      await db.execute('UPDATE pages SET deleted = 1, etag = $2, updated = $3, rev = rev + 1 WHERE id = $1 AND deleted = 0', [
        id,
        newEtag(),
        Date.now(),
      ]);
      mirror((g) => g.removePage(id));
    },

    async listTrash() {
      const rows = await db.select<PageRow[]>(
        `SELECT * FROM pages WHERE deleted = 1 AND kind IN ('page', 'card') AND NOT (title = '' AND blocks = '[]' AND arrows = '[]' AND tags = '[]') ORDER BY updated DESC`,
      );
      return rows.map(rowToPage);
    },

    purgePage,

    async purgeExpiredTrash(cutoff) {
      const old = await db.select<{ id: string }[]>(
        `SELECT id FROM pages WHERE deleted = 1 AND updated < $1 AND NOT (title = '' AND blocks = '[]' AND arrows = '[]' AND tags = '[]')`,
        [cutoff],
      );
      for (const r of old) await purgePage(r.id);
      // History of pages whose tombstone is empty (purged here or on another device) has nothing to come back to.
      await db.execute(
        `DELETE FROM page_snapshots WHERE page_id IN (SELECT id FROM pages WHERE deleted = 1 AND title = '' AND blocks = '[]' AND arrows = '[]' AND tags = '[]')`,
      );
      return old.length;
    },

    async listSnapshots(pageId) {
      const rows = await db.select<SnapshotRow[]>('SELECT * FROM page_snapshots WHERE page_id = $1 ORDER BY taken DESC', [pageId]);
      return rows.map((r): Snapshot => ({
        id: r.id, pageId: r.page_id, taken: r.taken, title: r.title,
        blocks: parseJson<Block[]>(r.blocks, []), arrows: parseJson(r.arrows, []),
      }));
    },

    snapshotPage(pageId, opts) {
      return takeSnapshot(pageId, !!opts?.force);
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
      mirror((g) => g.groups(groups.map((x) => ({ id: x.id, name: x.name, color: x.color, parentId: x.parentId }))));
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

    async pruneImages(usedByLivePages) {
      // Trashed pages and saved versions can come back, so their images stay too.
      const used = new Set(usedByLivePages);
      const keep = [
        ...(await db.select<{ blocks: string }[]>(`SELECT blocks FROM pages WHERE deleted = 1 AND blocks <> '[]'`)),
        ...(await db.select<{ blocks: string }[]>('SELECT blocks FROM page_snapshots')),
      ];
      for (const r of keep) for (const id of fileIdsOf(parseJson<Block[]>(r.blocks, []))) used.add(id);
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
