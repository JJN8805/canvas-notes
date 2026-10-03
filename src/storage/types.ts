import type { Block, Group, GroupColor, Page } from '../types';

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
}

export type SyncRecord = PageRecord | GroupRecord;

export interface ImagePayload {
  id: string;
  mime: string;
  /** base64 */
  data: string;
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
  saveGroups(groups: Group[]): Promise<void>;
  /** Stores image bytes and returns an id to keep in the page. */
  putImage(blob: Blob): Promise<string>;
  /** Object URL for an image id (cached). */
  imageUrl(id: string): Promise<string>;
  /** Removes images no page refers to. Returns how many were removed. */
  pruneImages(usedIds: Set<string>): Promise<number>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
  sync: SyncStore;
}

export function normalizePage(p: Partial<Page> & { id: string }): Page {
  return {
    id: p.id,
    title: typeof p.title === 'string' ? p.title : '',
    groupId: p.groupId ?? null,
    tags: Array.isArray(p.tags) ? p.tags : [],
    blocks: Array.isArray(p.blocks) ? p.blocks : [],
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
