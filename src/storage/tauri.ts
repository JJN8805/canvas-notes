import Database from '@tauri-apps/plugin-sql';
import { buildInfo } from '../lib/appInfo';
import { copyBeforeUpgrade, type CopyFs } from './preUpgradeCopy';
import { BaseDirectory, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { appConfigDir } from '@tauri-apps/api/path';
import type { Block, Group, GroupColor, Page } from '../types';
import { cleanColor } from '../lib/colors';
import { cleanSheet } from '../lib/sheet';
import { cleanDate, kindOf } from '../lib/pages';
import { shouldSnapshot, snapshotsToDrop } from '../lib/history';
import { newId } from '../lib/util';
import { assembleBlocks, sha256Hex, shareBlocks, packRefs, unpackRefs } from '../lib/contentHash';
import { assertSafeFile, FILE_EXT, isSafeId } from './validate';
import { fileIdsOf } from '../lib/files';
import { cleanIcon } from '../lib/pageIcon';
import { adopt, workspaceOf } from '../lib/workspaces';
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
  type SyncKind,
  type SyncRecord,
  type SyncStore,
  type VectorRow,
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
  cover: string;
  icon?: string;
  archived?: number;
  workspace?: string;
  created: number;
  updated: number;
  rev: number;
  etag: string;
  synced: string | null;
  deleted: number;
};
type GroupRow = { id: string; name: string; color: string; position: number; etag: string; synced: string | null; deleted: number; parent_id: string | null; scope: string | null; description: string | null; workspace?: string };
type SnapshotRow = { id: string; page_id: string; taken: number; title: string; blocks: string; arrows: string };
type ImageRow = { id: string; file: string; mime: string; created: number; sha256: string | null; size: number | null };

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
  // v5: was a second, relational copy of every page (the "graph"). It is gone (see v16); the step stays empty so the numbering of the rest does not change.
  [],
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
  // v11: card folders live beside page groups ('cards' = a folder or section of the Cards screen, '' = a page group)
  [`ALTER TABLE page_groups ADD COLUMN scope TEXT NOT NULL DEFAULT ''`],
  // v12: a description for a card folder or section ('' = none)
  [`ALTER TABLE page_groups ADD COLUMN description TEXT NOT NULL DEFAULT ''`],
  // v13: a page's cover picture, as a stored image id ('' = none)
  [`ALTER TABLE pages ADD COLUMN cover TEXT NOT NULL DEFAULT ''`],
  // v14: version history keeps each distinct box once; a saved version is then a list of fingerprints (see lib/contentHash.ts)
  [`CREATE TABLE IF NOT EXISTS history_blocks (hash TEXT PRIMARY KEY, json TEXT NOT NULL)`],
  // v15: files are matched by their content, so the same picture is kept once however many times it is added (sha256 NULL = not checked yet)
  [`ALTER TABLE images ADD COLUMN sha256 TEXT`, `ALTER TABLE images ADD COLUMN size INTEGER`, `CREATE INDEX IF NOT EXISTS images_sha256 ON images(sha256)`],
  // v16: removes the graph tables, which held a second and third copy of every page (the boxes again, and the text in a search index).
  // "Linked from" is worked out from the pages themselves now, so nothing read them. Fresh databases have none of this to drop.
  [
    `DROP VIEW IF EXISTS v_backlinks`, `DROP VIEW IF EXISTS v_page_tags`, `DROP VIEW IF EXISTS v_tag_counts`, `DROP VIEW IF EXISTS v_orphan_pages`,
    `DROP TRIGGER IF EXISTS blocks_fts_ai`, `DROP TRIGGER IF EXISTS blocks_fts_au`, `DROP TRIGGER IF EXISTS blocks_fts_ad`,
    `DROP TRIGGER IF EXISTS nodes_fts_ai`, `DROP TRIGGER IF EXISTS nodes_fts_au`, `DROP TRIGGER IF EXISTS nodes_fts_ad`,
    `DROP TABLE IF EXISTS search_blocks`, `DROP TABLE IF EXISTS search_nodes`,
    `DROP TABLE IF EXISTS connectors`, `DROP TABLE IF EXISTS blocks`, `DROP TABLE IF EXISTS edges`, `DROP TABLE IF EXISTS nodes`,
    `DROP TABLE IF EXISTS assets`, `DROP TABLE IF EXISTS sync_peers`, `DROP TABLE IF EXISTS devices`,
    `DELETE FROM settings WHERE key IN ('graph_device_id', 'graph_imported_at')`,
  ],
  // v17: embeddings for searching notes by meaning (derived from the pages, never synced or backed up; rebuilt on each device)
  [
    `CREATE TABLE IF NOT EXISTS embeddings (
      model TEXT NOT NULL, page_id TEXT NOT NULL, block_id TEXT NOT NULL, chunk INTEGER NOT NULL,
      hash TEXT NOT NULL, dim INTEGER NOT NULL, scale REAL NOT NULL, vec TEXT NOT NULL,
      PRIMARY KEY (model, page_id, block_id, chunk)
    )`,
  ],
  // v18: a page's icon, one emoji or short mark shown beside its name ('' = none)
  [`ALTER TABLE pages ADD COLUMN icon TEXT NOT NULL DEFAULT ''`],
  // v19: a page or card put in the Archive (1) stays stored, synced and backed up but leaves the library and search (0 = not archived)
  [`ALTER TABLE pages ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`],
  // v20: the workspace a page or group belongs to ('' = Main). Workspaces themselves are rows of page_groups with scope 'workspaces'.
  [`ALTER TABLE pages ADD COLUMN workspace TEXT NOT NULL DEFAULT ''`, `ALTER TABLE page_groups ADD COLUMN workspace TEXT NOT NULL DEFAULT ''`],
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
    cover: r.cover || null,
    ...(r.icon ? { icon: r.icon } : {}),
    ...(r.archived ? { archived: true } : {}),
    ...(r.workspace ? { workspace: r.workspace } : {}),
    created: r.created,
    updated: r.updated,
    rev: r.rev,
  });
}

/** A cover as stored: the picture's id, or '' for none (an unsafe id is treated as none). */
const coverId = (c: unknown) => (typeof c === 'string' && isSafeId(c) ? c : '');
/** A group's scope as stored: 'cards', 'workspaces' or '' (an ordinary page group). */
const groupScope = (v: unknown) => (v === 'cards' || v === 'workspaces' ? v : '');
/** An icon as stored: a short plain mark (an emoji), or '' for none. */
const iconOf = (c: unknown) => cleanIcon(c) ?? '';
/** The archive flag as stored: 1 only for an explicit `true`. */
const archivedOf = (c: unknown) => (c === true ? 1 : 0);

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
    ...(r.cover ? { cover: r.cover } : {}),
    ...(r.icon ? { icon: r.icon } : {}),
    ...(r.archived ? { archived: true } : {}),
    ...(r.workspace ? { workspace: r.workspace } : {}),
    created: r.created,
    updated: r.updated,
  };
}

function rowToGroupRecord(r: GroupRow): GroupRecord {
  return { id: r.id, etag: r.etag, deleted: !!r.deleted, name: r.name, color: r.color as GroupColor, position: r.position, parentId: r.parent_id ?? null, ...(r.scope === 'cards' || r.scope === 'workspaces' ? { scope: r.scope } : {}), ...(r.workspace ? { workspace: r.workspace } : {}), ...(r.description ? { description: r.description } : {}) };
}

const EXT = FILE_EXT;

const TABLE: Record<SyncKind, string> = { page: 'pages', group: 'page_groups' };

/** The app's own folder as the little file system `copyBeforeUpgrade` needs. */
const copyFs: CopyFs = {
  read: async (path) => {
    try {
      return await readFile(path, fsOpts);
    } catch {
      return null; // not there yet
    }
  },
  write: (path, bytes) => writeFile(path, bytes, fsOpts),
  mkdir: (path) => mkdir(path, { ...fsOpts, recursive: true }),
  remove: (path) => remove(path, { ...fsOpts, recursive: true }),
};

export async function createTauriStorage(): Promise<NotesStorage> {
  // A safety copy the first time this version opens the notes, before anything is read or converted. Never stops the app from starting.
  await copyBeforeUpgrade(copyFs, buildInfo().version).catch((e) => console.warn('Safety copy failed', e));
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

  /* ---- version history: each distinct box is stored once (history_blocks); a version lists which boxes it is made of ---- */

  /** Stores the boxes (those not already there) and returns the fingerprints in order. */
  async function storeBlocks(refs: string[], store: Map<string, string>) {
    for (const [hash, json] of store) await db.execute('INSERT OR IGNORE INTO history_blocks (hash, json) VALUES ($1, $2)', [hash, json]);
    return packRefs(refs);
  }

  /** The boxes of stored versions, resolved in one go. `text` is the stored form (fingerprints) or the older one (boxes written out). */
  async function loadVersionBlocks(texts: string[]): Promise<Block[][]> {
    const wanted = new Set<string>();
    for (const t of texts) for (const h of unpackRefs(t) ?? []) wanted.add(h);
    const lookup = new Map<string, string>();
    if (wanted.size) for (const r of await selectIn<{ hash: string; json: string }>((ph) => `SELECT hash, json FROM history_blocks WHERE hash IN (${ph})`, [...wanted])) lookup.set(r.hash, r.json);
    return texts.map((t) => {
      const refs = unpackRefs(t);
      return refs ? assembleBlocks(refs, lookup) : parseJson<Block[]>(t, []);
    });
  }

  /** Removes stored boxes that no version uses any more. */
  async function sweepHistory() {
    const used = new Set<string>();
    for (const r of await db.select<{ blocks: string }[]>("SELECT blocks FROM page_snapshots WHERE blocks LIKE '{%'")) for (const h of unpackRefs(r.blocks) ?? []) used.add(h);
    for (const { hash } of await db.select<{ hash: string }[]>('SELECT hash FROM history_blocks')) if (!used.has(hash)) await db.execute('DELETE FROM history_blocks WHERE hash = $1', [hash]);
  }

  /** Drops history this page no longer needs (see `snapshotsToDrop`). */
  async function thinSnapshots(pageId: string) {
    const rows = await db.select<{ id: string; taken: number }[]>('SELECT id, taken FROM page_snapshots WHERE page_id = $1', [pageId]);
    const drop = snapshotsToDrop(rows, Date.now());
    for (const id of drop) await db.execute('DELETE FROM page_snapshots WHERE id = $1', [id]);
    if (drop.length) await sweepHistory();
  }

  /**
   * Keeps the page as stored now as a version: its boxes go into the shared store (only the ones not already there are added), and the
   * version is the list of them. Skips blank pages and a copy of the newest version. Without `force`, at most one an hour.
   */
  async function takeSnapshot(pageId: string, force: boolean): Promise<boolean> {
    const now = Date.now();
    if (!force) {
      const last = await db.select<{ t: number | null }[]>('SELECT MAX(taken) AS t FROM page_snapshots WHERE page_id = $1', [pageId]);
      if (!shouldSnapshot(last[0]?.t ?? null, now)) return false;
    }
    const page = (await db.select<{ title: string; blocks: string; arrows: string }[]>('SELECT title, blocks, arrows FROM pages WHERE id = $1 AND deleted = 0', [pageId]))[0];
    if (!page || (page.title === '' && page.blocks === '[]' && page.arrows === '[]')) return false;
    const { refs, store } = await shareBlocks(parseJson<Block[]>(page.blocks, []));
    const newest = (await db.select<SnapshotRow[]>('SELECT * FROM page_snapshots WHERE page_id = $1 ORDER BY taken DESC LIMIT 1', [pageId]))[0];
    if (newest && newest.title === page.title && newest.arrows === page.arrows) {
      const same = unpackRefs(newest.blocks);
      if (same ? same.length === refs.length && same.every((h, i) => h === refs[i]) : newest.blocks === page.blocks) return false;
    }
    const packed = await storeBlocks(refs, store);
    await db.execute('INSERT INTO page_snapshots (id, page_id, taken, title, blocks, arrows) VALUES ($1, $2, $3, $4, $5, $6)', [newId(), pageId, now, page.title, packed, page.arrows]);
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
      `UPDATE pages SET title = '', tags = '[]', blocks = '[]', arrows = '[]', drawing = '', color = NULL, daily_date = NULL, sheet = '', cover = '', icon = '', archived = 0, workspace = '', etag = $2, rev = rev + 1 WHERE id = $1 AND deleted = 1`,
      [id, newEtag()],
    );
    await db.execute('DELETE FROM page_snapshots WHERE page_id = $1', [id]);
    await sweepHistory();
  }

  /** Values in the order used by the page INSERT/UPDATE statements below. */
  const pageValues = (r: PageRecord) => [
    r.id, r.title, r.groupId, JSON.stringify(r.tags), JSON.stringify(r.blocks), JSON.stringify(r.arrows ?? []),
    r.created, r.updated, r.etag, r.deleted ? 1 : 0, r.drawing ? JSON.stringify(r.drawing) : '', r.color ?? null,
    kindOf(r), cleanDate(r.dailyDate), sheetJson(r.sheet), coverId(r.cover), iconOf(r.icon), archivedOf(r.archived), workspaceOf(r),
  ];
  const groupValues = (r: GroupRecord) => [r.id, r.name, r.color, r.position, r.etag, r.deleted ? 1 : 0, r.parentId ?? null, groupScope(r.scope), r.description ?? '', workspaceOf(r)];

  const toGroup = (g: GroupRow): Group => ({ id: g.id, name: g.name, color: g.color as GroupColor, parentId: g.parent_id ?? null, ...(g.scope === 'cards' || g.scope === 'workspaces' ? { scope: g.scope } : {}), ...(g.workspace ? { workspace: g.workspace } : {}), ...(g.description ? { description: g.description } : {}) });

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
          `INSERT INTO pages (id, title, group_id, tags, blocks, arrows, created, updated, etag, deleted, drawing, color, kind, daily_date, sheet, cover, rev, synced, icon, archived, workspace)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 1, $9, $17, $18, $19)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title, group_id = excluded.group_id, tags = excluded.tags, blocks = excluded.blocks, arrows = excluded.arrows, drawing = excluded.drawing, color = excluded.color, kind = excluded.kind, daily_date = excluded.daily_date, sheet = excluded.sheet, cover = excluded.cover, icon = excluded.icon, archived = excluded.archived, workspace = excluded.workspace,
             created = excluded.created, updated = excluded.updated, etag = excluded.etag, deleted = excluded.deleted,
             synced = excluded.etag, rev = pages.rev + 1`,
          pageValues(rec as PageRecord),
        );
      } else {
        await db.execute(
          `INSERT INTO page_groups (id, name, color, position, etag, deleted, parent_id, synced, scope, description, workspace)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $5, $8, $9, $10)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, color = excluded.color, position = excluded.position,
             etag = excluded.etag, deleted = excluded.deleted, parent_id = excluded.parent_id, scope = excluded.scope, description = excluded.description, workspace = excluded.workspace, synced = excluded.etag`,
          groupValues(rec as GroupRecord),
        );
      }
    },

    async applyRemoteIf(kind, rec, base) {
      if (kind === 'page' && base !== null) await snapshotIfReplacing(rec as PageRecord);
      let affected: number;
      if (base === null) {
        if (kind === 'page') {
          affected = (
            await db.execute(
              `INSERT INTO pages (id, title, group_id, tags, blocks, arrows, created, updated, etag, deleted, drawing, color, kind, daily_date, sheet, cover, rev, synced, icon, archived, workspace)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 1, $9, $17, $18, $19) ON CONFLICT(id) DO NOTHING`,
              pageValues(rec as PageRecord),
            )
          ).rowsAffected;
        } else {
          affected = (
            await db.execute(
              `INSERT INTO page_groups (id, name, color, position, etag, deleted, parent_id, synced, scope, description, workspace)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $5, $8, $9, $10) ON CONFLICT(id) DO NOTHING`,
              groupValues(rec as GroupRecord),
            )
          ).rowsAffected;
        }
      } else if (kind === 'page') {
        affected = (
          await db.execute(
            `UPDATE pages SET title = $2, group_id = $3, tags = $4, blocks = $5, arrows = $6, created = $7, updated = $8,
               etag = $9, deleted = $10, drawing = $11, color = $12, kind = $13, daily_date = $14, sheet = $15, cover = $16, icon = $17, archived = $18, workspace = $19, synced = $9, rev = rev + 1
             WHERE id = $1 AND etag = $20`,
            [...pageValues(rec as PageRecord), base],
          )
        ).rowsAffected;
      } else {
        affected = (
          await db.execute(
            `UPDATE page_groups SET name = $2, color = $3, position = $4, etag = $5, deleted = $6, parent_id = $7, scope = $8, description = $9, workspace = $10, synced = $5
             WHERE id = $1 AND etag = $11`,
            [...groupValues(rec as GroupRecord), base],
          )
        ).rowsAffected;
      }
      // A retried request whose first attempt already landed also counts as accepted.
      const accepted = affected > 0 || (await currentEtag(kind, rec.id)) === rec.etag;
      return accepted;
    },

    async markSynced(kind, id, etag) {
      await db.execute(`UPDATE ${TABLE[kind]} SET synced = $2 WHERE id = $1`, [id, etag]);
    },

    async insertLocalPage(r) {
      await db.execute(
        `INSERT INTO pages (id, title, group_id, tags, blocks, arrows, created, updated, etag, deleted, drawing, color, kind, daily_date, sheet, cover, rev, synced, icon, archived, workspace)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, $12, $13, $14, $15, 1, NULL, $16, $17, $18)`,
        [r.id, r.title, r.groupId, JSON.stringify(r.tags), JSON.stringify(r.blocks), JSON.stringify(r.arrows ?? []), r.created, r.updated, newEtag(), r.drawing ? JSON.stringify(r.drawing) : '', r.color ?? null, kindOf(r), cleanDate(r.dailyDate), sheetJson(r.sheet), coverId(r.cover), iconOf(r.icon), archivedOf(r.archived), workspaceOf(r)],
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
      // The id becomes a file name and comes from another device or a backup file: never trust it.
      assertSafeFile(img);
      const exists = await db.select<{ id: string }[]>('SELECT id FROM images WHERE id = $1', [img.id]);
      if (exists.length) return;
      const bytes = base64ToBytes(img.data);
      const hash = await sha256Hex(bytes);
      // Pages from another device name this picture by its own id; if the same bytes are already here under another id,
      // this id just points at the file that is already kept.
      const twin = (await db.select<ImageRow[]>('SELECT * FROM images WHERE sha256 = $1 AND mime = $2 LIMIT 1', [hash, img.mime]))[0];
      const file = twin ? twin.file : `${img.id}.${EXT[img.mime] ?? 'bin'}`;
      if (!twin) await writeFile(`${IMG_DIR}/${file}`, bytes, fsOpts);
      await db.execute('INSERT OR IGNORE INTO images (id, file, mime, created, sha256, size) VALUES ($1, $2, $3, $4, $5, $6)', [img.id, file, img.mime, Date.now(), hash, bytes.length]);
    },
  };

  /** Deletes a stored file once no picture id points at it any more. */
  async function removeFileIfUnused(file: string) {
    if ((await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM images WHERE file = $1', [file]))[0].n > 0) return;
    try {
      await remove(`${IMG_DIR}/${file}`, fsOpts);
    } catch {
      /* already gone */
    }
  }

  /**
   * Finds files with the same content and keeps one of each. Files saved before this existed have no fingerprint yet: each run checks
   * a batch, so it can be stopped at any time and carries on later. The ids in pages never change, only which file they point at.
   */
  async function mergeDuplicateFiles(): Promise<{ merged: number; freed: number }> {
    let merged = 0;
    let freed = 0;
    for (;;) {
      const rows = await db.select<ImageRow[]>('SELECT * FROM images WHERE sha256 IS NULL LIMIT 20');
      if (!rows.length) break;
      for (const r of rows) {
        let bytes: Uint8Array;
        try {
          bytes = await readFile(`${IMG_DIR}/${r.file}`, fsOpts);
        } catch {
          await db.execute("UPDATE images SET sha256 = '' WHERE id = $1", [r.id]); // the file is missing: leave it alone, and don't look again
          continue;
        }
        const hash = await sha256Hex(bytes);
        const twin = (await db.select<ImageRow[]>("SELECT * FROM images WHERE sha256 = $1 AND mime = $2 AND file <> $3 LIMIT 1", [hash, r.mime, r.file]))[0];
        if (twin) {
          await db.execute('UPDATE images SET file = $2, sha256 = $3, size = $4 WHERE id = $1', [r.id, twin.file, hash, bytes.length]);
          if ((await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM images WHERE file = $1', [r.file]))[0].n === 0) {
            await removeFileIfUnused(r.file);
            merged++;
            freed += bytes.length;
          }
        } else await db.execute('UPDATE images SET sha256 = $2, size = $3 WHERE id = $1', [r.id, hash, bytes.length]);
      }
    }
    return { merged, freed };
  }

  /** Turns versions written out in full (the older form) into lists of shared boxes, a batch at a time. */
  async function convertOldVersions(): Promise<number> {
    let done = 0;
    for (;;) {
      const rows = await db.select<SnapshotRow[]>("SELECT * FROM page_snapshots WHERE blocks LIKE '[%' LIMIT 30");
      if (!rows.length) break;
      for (const r of rows) {
        const { refs, store } = await shareBlocks(parseJson<Block[]>(r.blocks, []));
        await db.execute('UPDATE page_snapshots SET blocks = $2 WHERE id = $1', [r.id, await storeBlocks(refs, store)]);
        done++;
      }
    }
    return done;
  }

  const tidy: NotesStorage['tidy'] = async () => {
    const files = await mergeDuplicateFiles();
    const versionsConverted = await convertOldVersions();
    if (versionsConverted) await sweepHistory();
    return { filesMerged: files.merged, bytesFreed: files.freed, versionsConverted };
  };

  const report: NotesStorage['report'] = async () => {
    const one = async (sql: string) => Number(((await db.select<Record<string, number | null>[]>(sql))[0]?.n as number | null) ?? 0);
    const sizes = new Map((await db.select<{ hash: string; l: number }[]>('SELECT hash, LENGTH(json) AS l FROM history_blocks')).map((r) => [r.hash, r.l]));
    let versionBytesIfCopied = 0;
    let historyBoxUses = 0;
    for (const r of await db.select<{ blocks: string }[]>('SELECT blocks FROM page_snapshots')) {
      const refs = unpackRefs(r.blocks);
      if (refs) {
        historyBoxUses += refs.length;
        versionBytesIfCopied += 2 + refs.reduce((n, h) => n + (sizes.get(h) ?? 0) + 1, 0);
      } else versionBytesIfCopied += r.blocks.length;
    }
    return {
      pages: await one('SELECT COUNT(*) AS n FROM pages WHERE deleted = 0'),
      pageBytes: await one('SELECT SUM(LENGTH(blocks)) AS n FROM pages WHERE deleted = 0'),
      versions: await one('SELECT COUNT(*) AS n FROM page_snapshots'),
      versionBytes: (await one('SELECT SUM(LENGTH(json)) AS n FROM history_blocks')) + (await one('SELECT SUM(LENGTH(blocks)) AS n FROM page_snapshots')),
      versionBytesIfCopied,
      historyBoxes: await one('SELECT COUNT(*) AS n FROM history_blocks'),
      historyBoxUses,
      fileUses: await one('SELECT COUNT(*) AS n FROM images'),
      files: await one('SELECT COUNT(DISTINCT file) AS n FROM images'),
      fileBytes: await one('SELECT SUM(s) AS n FROM (SELECT MAX(COALESCE(size, 0)) AS s FROM images GROUP BY file)'),
      fileBytesIfCopied: await one('SELECT SUM(COALESCE(size, 0)) AS n FROM images'),
      pending: (await one('SELECT COUNT(*) AS n FROM images WHERE sha256 IS NULL')) + (await one("SELECT COUNT(*) AS n FROM page_snapshots WHERE blocks LIKE '[%'")),
    };
  };

  return {
    kind: 'desktop',
    tidy,
    report,
    sync,

    async location() {
      return appConfigDir();
    },

    async loadAll() {
      const pageRows = await db.select<PageRow[]>('SELECT * FROM pages WHERE deleted = 0');
      const groupRows = await db.select<GroupRow[]>('SELECT * FROM page_groups WHERE deleted = 0 ORDER BY position, name');
      return {
        pages: pageRows.map(rowToPage),
        groups: groupRows.map(toGroup),
      };
    },

    async outline() {
      const rows = await db.select<{ id: string; title: string; kind: string | null; workspace: string; icon: string; archived: number; updated: number }[]>(
        'SELECT id, title, kind, workspace, icon, archived, updated FROM pages WHERE deleted = 0',
      );
      const known = new Set((await db.select<{ id: string }[]>("SELECT id FROM page_groups WHERE scope = 'workspaces' AND deleted = 0")).map((g) => g.id));
      return rows.map((r) => ({ id: r.id, title: r.title, kind: kindOf({ kind: r.kind }), workspace: known.has(r.workspace) ? workspaceOf(r) : '', updated: r.updated, ...(r.icon ? { icon: r.icon } : {}), ...(r.archived ? { archived: true } : {}) }));
    },

    async loadChanged(known, scope) {
      const revs = scope === null
        ? await db.select<{ id: string; rev: number }[]>('SELECT id, rev FROM pages WHERE deleted = 0')
        : scope === ''
          // Main also holds pages whose workspace has no row (deleted on another device), so they are never hidden for good.
          ? await db.select<{ id: string; rev: number }[]>("SELECT id, rev FROM pages WHERE deleted = 0 AND (workspace = '' OR workspace NOT IN (SELECT id FROM page_groups WHERE scope = 'workspaces' AND deleted = 0))")
          : await db.select<{ id: string; rev: number }[]>("SELECT id, rev FROM pages WHERE deleted = 0 AND (workspace = $1 OR (kind = 'template' AND workspace = ''))", [scope]);
      const want = revs.filter((r) => known[r.id] !== r.rev).map((r) => r.id);
      const rows = want.length ? await selectIn<PageRow>((ph) => `SELECT * FROM pages WHERE id IN (${ph}) AND deleted = 0`, want) : [];
      const groupRows = await db.select<GroupRow[]>('SELECT * FROM page_groups WHERE deleted = 0 ORDER BY position, name');
      const groups = groupRows.map(toGroup);
      return { pages: adopt(rows.map(rowToPage), groups.filter((g) => g.scope === 'workspaces')), ids: revs.map((r) => r.id), groups };
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
      const cover = coverId(page.cover);
      const icon = iconOf(page.icon);
      const archived = archivedOf(page.archived);
      const workspace = workspaceOf(page);
      const etag = newEtag();
      await safeSnapshot(page.id, false); // the page as it was before this save
      const upd = await db.execute(
        `UPDATE pages SET title = $1, group_id = $2, tags = $3, blocks = $4, arrows = $5, updated = $6, etag = $9, drawing = $10, color = $11, kind = $12, daily_date = $13, sheet = $14, cover = $15, icon = $16, archived = $17, workspace = $18, rev = rev + 1
         WHERE id = $7 AND rev = $8 AND deleted = 0`,
        [page.title, page.groupId, tags, blocks, arrows, page.updated, page.id, page.rev, etag, drawing, color, kind, dailyDate, sheet, cover, icon, archived, workspace],
      );
      if (upd.rowsAffected > 0) {
        return { ok: true, rev: page.rev + 1 };
      }

      const existing = await db.select<{ rev: number; deleted: number }[]>('SELECT rev, deleted FROM pages WHERE id = $1', [page.id]);
      if (existing.length && !existing[0].deleted) return { ok: false, reason: 'conflict' };
      if (existing.length) {
        // Deleted here or on the other device, but edited again: the edit brings the page back.
        await db.execute(
          `UPDATE pages SET title = $1, group_id = $2, tags = $3, blocks = $4, arrows = $5, updated = $6, etag = $7, deleted = 0, drawing = $9, color = $10, kind = $11, daily_date = $12, sheet = $13, cover = $14, icon = $15, archived = $16, workspace = $17, rev = rev + 1
           WHERE id = $8`,
          [page.title, page.groupId, tags, blocks, arrows, page.updated, etag, page.id, drawing, color, kind, dailyDate, sheet, cover, icon, archived, workspace],
        );
        const r = await db.select<{ rev: number }[]>('SELECT rev FROM pages WHERE id = $1', [page.id]);
        return { ok: true, rev: r[0]?.rev ?? existing[0].rev + 1 };
      }
      await db.execute(
        `INSERT INTO pages (id, title, group_id, tags, blocks, arrows, created, updated, rev, etag, synced, deleted, drawing, color, kind, daily_date, sheet, cover, icon, archived, workspace)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, NULL, 0, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [page.id, page.title, page.groupId, tags, blocks, arrows, page.created, page.updated, etag, drawing, color, kind, dailyDate, sheet, cover, icon, archived, workspace],
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
      await sweepHistory();
      return old.length;
    },

    async listSnapshots(pageId) {
      const rows = await db.select<SnapshotRow[]>('SELECT * FROM page_snapshots WHERE page_id = $1 ORDER BY taken DESC', [pageId]);
      const boxes = await loadVersionBlocks(rows.map((r) => r.blocks));
      return rows.map((r, i): Snapshot => ({ id: r.id, pageId: r.page_id, taken: r.taken, title: r.title, blocks: boxes[i], arrows: parseJson(r.arrows, []) }));
    },

    snapshotPage(pageId, opts) {
      return takeSnapshot(pageId, !!opts?.force);
    },

    async saveGroups(groups: Group[]) {
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const scope = groupScope(g.scope);
        const workspace = workspaceOf(g);
        const description = scope === 'cards' ? (g.description ?? '') : '';
        // Only rows that really changed get a new etag, so sync sends just those.
        const upd = await db.execute(
          `UPDATE page_groups SET name = $2, color = $3, position = $4, parent_id = $6, scope = $7, description = $8, workspace = $9, deleted = 0, etag = $5
           WHERE id = $1 AND (name IS NOT $2 OR color IS NOT $3 OR position IS NOT $4 OR parent_id IS NOT $6 OR scope IS NOT $7 OR description IS NOT $8 OR workspace IS NOT $9 OR deleted = 1)`,
          [g.id, g.name, g.color, i, newEtag(), g.parentId ?? null, scope, description, workspace],
        );
        if (upd.rowsAffected === 0) {
          await db.execute(
            `INSERT INTO page_groups (id, name, color, position, etag, parent_id, synced, deleted, scope, description, workspace)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, 0, $7, $8, $9) ON CONFLICT(id) DO NOTHING`,
            [g.id, g.name, g.color, i, newEtag(), g.parentId ?? null, scope, description, workspace],
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
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const mime = blob.type || 'image/png';
      const hash = await sha256Hex(bytes);
      // The same bytes are never stored twice: adding a picture that is already kept gives back the id it already has.
      const twin = (await db.select<{ id: string }[]>('SELECT id FROM images WHERE sha256 = $1 AND mime = $2 LIMIT 1', [hash, mime]))[0];
      if (twin) return twin.id;
      const id = newId();
      const file = `${id}.${EXT[mime] ?? 'bin'}`;
      await writeFile(`${IMG_DIR}/${file}`, bytes, fsOpts);
      await db.execute('INSERT INTO images (id, file, mime, created, sha256, size) VALUES ($1, $2, $3, $4, $5, $6)', [id, file, mime, Date.now(), hash, bytes.length]);
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
        ...(await db.select<{ blocks: string; cover?: string }[]>(`SELECT blocks, cover FROM pages WHERE deleted = 1 AND (blocks <> '[]' OR cover <> '')`)),
        // saved versions: the shared boxes (each wrapped as a one-box list) and any older versions still written out in full
        ...(await db.select<{ blocks: string; cover?: string }[]>("SELECT '[' || json || ']' AS blocks FROM history_blocks")),
        ...(await db.select<{ blocks: string; cover?: string }[]>("SELECT blocks FROM page_snapshots WHERE blocks LIKE '[%'")),
      ];
      for (const r of keep) for (const id of fileIdsOf(parseJson<Block[]>(r.blocks, []))) used.add(id);
      for (const r of keep) if (r.cover) used.add(r.cover);
      const rows = await db.select<ImageRow[]>('SELECT * FROM images');
      const cutoff = Date.now() - 10 * 60 * 1000;
      let n = 0;
      for (const r of rows) {
        if (used.has(r.id) || r.created > cutoff) continue;
        await db.execute('DELETE FROM images WHERE id = $1', [r.id]);
        await removeFileIfUnused(r.file); // another id may share the file: it stays until the last one goes
        n++;
      }
      return n;
    },

    vectors: {
      async load(model) {
        const rows = await db.select<Record<string, unknown>[]>('SELECT page_id, block_id, chunk, hash, model, dim, scale, vec FROM embeddings WHERE model = $1', [model]);
        return rows.map((r) => cleanVectorRow({ pageId: r.page_id, blockId: r.block_id, chunk: r.chunk, hash: r.hash, model: r.model, dim: r.dim, scale: r.scale, vec: r.vec })).filter((r): r is VectorRow => !!r);
      },
      async put(rows) {
        for (const r of rows) {
          const c = cleanVectorRow(r);
          if (!c) continue;
          await db.execute(
            'INSERT INTO embeddings (model, page_id, block_id, chunk, hash, dim, scale, vec) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(model, page_id, block_id, chunk) DO UPDATE SET hash = excluded.hash, dim = excluded.dim, scale = excluded.scale, vec = excluded.vec',
            [c.model, c.pageId, c.blockId, c.chunk, c.hash, c.dim, c.scale, c.vec],
          );
        }
      },
      async remove(model, keys) {
        for (const k of keys) await db.execute('DELETE FROM embeddings WHERE model = $1 AND page_id = $2 AND block_id = $3 AND chunk = $4', [model, k.pageId, k.blockId, k.chunk]);
      },
      async clear(keepModel) {
        if (keepModel === undefined) await db.execute('DELETE FROM embeddings');
        else await db.execute('DELETE FROM embeddings WHERE model <> $1', [keepModel]);
      },
      async count(model) {
        const rows = model === undefined ? await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM embeddings') : await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM embeddings WHERE model = $1', [model]);
        return rows[0]?.n ?? 0;
      },
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
