import { cleanArrows, cleanBlocks, cleanTags } from '../lib/sanitize';
import { cleanIcon } from '../lib/pageIcon';
import { cleanColor } from '../lib/colors';
import { cleanDate, kindOf } from '../lib/pages';
import { cleanSheet, sheetCovering } from '../lib/sheet';
import { isSafeId } from './validate';
import type { Arrow, Block, Group, GroupColor, NoteColor, Page, PageDrawing, PageKind, Sheet } from '../types';

export type SaveResult = { ok: true; rev: number } | { ok: false; reason: 'conflict' };

/* ------------------------------------------------------------------ */
/* Sync records                                                        */
/* ------------------------------------------------------------------ */
//
// Every page and group row carries:
//   etag    – random id that changes on every local save (or arrives with a synced copy)
//   synced  – the etag both devices agreed on at the last sync (null = never synced)
//   deleted – deletions are kept as "tombstones" so they can sync too
// A row has local changes when etag !== synced.

export type SyncKind = 'page' | 'group';

export interface SyncMeta {
  id: string;
  etag: string;
  synced: string | null;
  deleted: boolean;
}

export interface PageRecord {
  id: string;
  etag: string;
  deleted: boolean;
  title: string;
  groupId: string | null;
  tags: string[];
  blocks: Block[];
  arrows: Arrow[];
  /** Absent in records from app versions before page drawings. */
  drawing?: PageDrawing | null;
  /** Absent in records from app versions before templates and daily pages. */
  kind?: PageKind;
  dailyDate?: string | null;
  /** Absent in records from app versions before finite pages: an infinite page. */
  sheet?: Sheet | null;
  /** The id of the page's cover picture; absent in records from app versions before covers. */
  cover?: string | null;
  /** The page's icon; absent in records from app versions before icons. */
  icon?: string | null;
  /** Absent in records from app versions before page colours. */
  color?: NoteColor | null;
  created: number;
  updated: number;
}

export interface GroupRecord {
  id: string;
  etag: string;
  deleted: boolean;
  name: string;
  color: GroupColor;
  position: number;
  /** Absent in records from app versions before subgroups; treated as top level. */
  parentId?: string | null;
  /** 'cards' for a card folder; absent for a page group (and in records from app versions before card folders). */
  scope?: 'cards';
  /** The description of a card folder; absent when it has none (and in records from older app versions). */
  description?: string;
}

export type SyncRecord = PageRecord | GroupRecord;

export interface ImagePayload {
  id: string;
  mime: string;
  /** base64 */
  data: string;
}

/** How much room things take, and how much less than if everything were copied. All sizes are bytes. */
export interface StorageReport {
  pages: number;
  /** The pages' own boxes. */
  pageBytes: number;
  /** Saved versions, and what they take: each distinct box once, plus the lists that say which boxes make up each version. */
  versions: number;
  versionBytes: number;
  /** What the same versions would take if every one were written out in full. */
  versionBytesIfCopied: number;
  /** Boxes stored for history, and how many times versions use them. */
  historyBoxes: number;
  historyBoxUses: number;
  /** Pictures, sounds and documents: places that use a file, the distinct files kept, and what they take. */
  fileUses: number;
  files: number;
  fileBytes: number;
  /** What the same files would take if each use had its own copy. */
  fileBytesIfCopied: number;
  /** Files not yet checked for duplicates and versions not yet converted (run `tidy` to finish them). */
  pending: number;
}

export interface TidyResult {
  /** Files that turned out to be copies of one already kept, and the bytes that freed. */
  filesMerged: number;
  bytesFreed: number;
  /** Old versions converted to the shared form. */
  versionsConverted: number;
}

/** An earlier version of a page, kept on this device only (never synced). */
export interface Snapshot {
  id: string;
  pageId: string;
  taken: number;
  title: string;
  blocks: Block[];
  arrows: Arrow[];
}

export interface SyncStore {
  listMeta(kind: SyncKind): Promise<SyncMeta[]>;
  getRecords(kind: SyncKind, ids: string[]): Promise<SyncRecord[]>;
  /** Store a record from the other device as-is and mark it as in sync. */
  applyRemote(kind: SyncKind, rec: SyncRecord): Promise<void>;
  /**
   * Store a record only if our current etag equals `base` (null = we must not have it).
   * Used by the laptop so a phone can never overwrite a change it hasn't seen.
   */
  applyRemoteIf(kind: SyncKind, rec: SyncRecord, base: string | null): Promise<boolean>;
  markSynced(kind: SyncKind, id: string, etag: string): Promise<void>;
  /** Insert a brand-new local page (used for conflicted copies). */
  insertLocalPage(rec: Omit<PageRecord, 'etag' | 'deleted'>): Promise<void>;
  listImageIds(): Promise<string[]>;
  readImage(id: string): Promise<ImagePayload | null>;
  writeImage(img: ImagePayload): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

/**
 * One passage's embedding, for searching notes by meaning. Derived from the pages, so it is never synced or put in a backup: every device
 * builds its own, and it can be deleted at any time (it is rebuilt). `vec` is one signed byte per number, base64 (see addons/ai/rag/vectors.ts).
 */
export interface VectorRow {
  pageId: string;
  blockId: string;
  chunk: number;
  /** Fingerprint of the passage text it was made from. */
  hash: string;
  /** Which model made it: `local:nomic-embed-text`, `openai:text-embedding-3-small` … Vectors of different models can't be compared. */
  model: string;
  dim: number;
  scale: number;
  vec: string;
}

export type VectorKey = Pick<VectorRow, 'pageId' | 'blockId' | 'chunk'>;

export interface VectorStore {
  /** Every stored vector of one model. */
  load(model: string): Promise<VectorRow[]>;
  /** Adds or replaces vectors (one per page, box, piece and model). */
  put(rows: VectorRow[]): Promise<void>;
  remove(model: string, keys: VectorKey[]): Promise<void>;
  /** Deletes every vector, or every vector except those of `keepModel`. */
  clear(keepModel?: string): Promise<void>;
  /** How many vectors there are, of one model or of all. */
  count(model?: string): Promise<number>;
}

/** A stored vector read back is checked before it is trusted: a damaged row is dropped, never fatal. */
export function cleanVectorRow(r: unknown): VectorRow | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const { pageId, blockId, chunk, hash, model, dim, scale, vec } = o;
  if (typeof pageId !== 'string' || typeof blockId !== 'string' || typeof hash !== 'string' || typeof model !== 'string' || typeof vec !== 'string') return null;
  if (!Number.isInteger(chunk) || (chunk as number) < 0 || !Number.isInteger(dim) || (dim as number) < 1 || (dim as number) > 4096) return null;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return null;
  return { pageId, blockId, chunk: chunk as number, hash, model, dim: dim as number, scale, vec };
}

export interface NotesStorage {
  /** 'desktop' = SQLite + image files via Tauri, 'browser' = IndexedDB (for `npm run dev`). */
  kind: 'desktop' | 'browser';
  /** Human-readable location of the data, shown in the sidebar. */
  location(): Promise<string>;
  loadAll(): Promise<{ pages: Page[]; groups: Group[] }>;
  loadPage(id: string): Promise<Page | null>;
  /**
   * Saves a page if the copy on disk still has `page.rev`.
   * Returns the new revision, or a conflict when something else saved in between.
   */
  savePage(page: Page): Promise<SaveResult>;
  /** Marks a page deleted (kept as a tombstone so the deletion syncs). */
  deletePage(id: string): Promise<void>;
  /** Deleted pages that can still be restored (not purged), newest deletion first; `updated` is the deletion time. */
  listTrash(): Promise<Page[]>;
  /** Empties a trashed page for good but keeps the tombstone, with a new etag so the purge syncs. */
  purgePage(id: string): Promise<void>;
  /** Purges trashed pages deleted before `cutoff` and drops history of purged pages. Returns how many pages were purged. */
  purgeExpiredTrash(cutoff: number): Promise<number>;
  /** Saved versions of a page, newest first. */
  listSnapshots(pageId: string): Promise<Snapshot[]>;
  /**
   * Keeps the page as stored now as a version. Without `force` it happens at most once an hour.
   * Blank pages and a copy of the newest version are skipped. Returns whether one was added.
   */
  snapshotPage(pageId: string, opts?: { force?: boolean }): Promise<boolean>;
  saveGroups(groups: Group[]): Promise<void>;
  /** Stores image bytes and returns an id to keep in the page. */
  putImage(blob: Blob): Promise<string>;
  /** Object URL for an image id (cached). */
  imageUrl(id: string): Promise<string>;
  /** Removes images no page refers to. Returns how many were removed. */
  pruneImages(usedIds: Set<string>): Promise<number>;
  /** How much is stored, and how much of it is shared instead of copied (for Settings → Data). */
  report(): Promise<StorageReport>;
  /**
   * Brings data written by earlier versions into the shared form: files with the same content become one, and old version history written
   * out in full becomes lists of shared boxes. Safe to run at any time and as often as you like; each run picks up where the last stopped.
   */
  tidy(): Promise<TidyResult>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
  /** Embeddings for searching by meaning (derived data: not synced, not backed up). */
  vectors: VectorStore;
  sync: SyncStore;
}

export function normalizePage(p: Partial<Page> & { id: string }): Page {
  const blocks = cleanBlocks(p.blocks);
  const sheet = cleanSheet(p.sheet);
  return {
    id: p.id,
    title: typeof p.title === 'string' ? p.title : '',
    groupId: p.groupId ?? null,
    tags: cleanTags(p.tags),
    blocks,
    arrows: cleanArrows(p.arrows),
    drawing: p.drawing ?? null,
    color: cleanColor(p.color),
    kind: kindOf(p),
    dailyDate: cleanDate(p.dailyDate),
    sheet: sheet && sheetCovering(sheet, blocks),
    cover: typeof p.cover === 'string' && isSafeId(p.cover) ? p.cover : null,
    icon: cleanIcon(p.icon),
    created: p.created ?? Date.now(),
    updated: p.updated ?? p.created ?? Date.now(),
    rev: p.rev ?? 0,
  };
}

export function newEtag(): string {
  const a = crypto.getRandomValues(new Uint32Array(3));
  return Array.from(a, (n) => n.toString(36)).join('');
}

/* base64 helpers for moving image bytes inside JSON */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
