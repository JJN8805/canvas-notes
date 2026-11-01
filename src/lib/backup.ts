/** Whole-library backup: every page, group and image in one JSON file, and putting one back. */
import { normalizePage, type NotesStorage, type PageRecord } from '../storage/types';
import type { Group } from '../types';

const FORMAT = 'canvas-notes-backup';

export interface BackupImage {
  id: string;
  mime: string;
  data: string;
}

export interface Backup {
  format: typeof FORMAT;
  version: 1;
  exported: number;
  groups: Group[];
  pages: PageRecord[];
  images: BackupImage[];
}

/** Collects everything that isn't deleted (trashed pages are left out). */
export async function buildBackup(storage: NotesStorage, now = Date.now()): Promise<Backup> {
  const { pages, groups } = await storage.loadAll();
  const records = (await storage.sync.getRecords('page', pages.map((p) => p.id))) as PageRecord[];
  const used = new Set<string>();
  for (const r of records) for (const b of r.blocks) if (b.type === 'image') used.add(b.imageId);
  const images: BackupImage[] = [];
  for (const id of used) {
    const img = await storage.sync.readImage(id);
    if (img) images.push(img);
  }
  return { format: FORMAT, version: 1, exported: now, groups, pages: records.filter((r) => !r.deleted), images };
}

/** Reads a backup file's text. Throws a message fit to show the user when it isn't one. */
export function parseBackup(text: string): Backup {
  let raw: Partial<Backup>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a Canvas Notes backup.');
  }
  if (!raw || raw.format !== FORMAT || !Array.isArray(raw.pages)) throw new Error('That file isn’t a Canvas Notes backup.');
  if (raw.version !== 1) throw new Error('That backup was made by a newer version of Canvas Notes. Update the app and try again.');
  const str = (v: unknown) => typeof v === 'string' && v !== '';
  return {
    format: FORMAT,
    version: 1,
    exported: Number(raw.exported) || 0,
    groups: (Array.isArray(raw.groups) ? raw.groups : []).filter((g) => g && str(g.id) && typeof g.name === 'string'),
    pages: raw.pages.filter((p) => p && str(p.id)),
    images: (Array.isArray(raw.images) ? raw.images : []).filter((i) => i && str(i.id) && str(i.data)),
  };
}

export interface RestoreResult {
  pages: number;
  skipped: number;
  groups: number;
}

/**
 * Adds what the backup has and this library doesn't. Nothing that exists is overwritten:
 * pages and groups already here (same id, even if in Trash) are skipped.
 */
export async function restoreBackup(storage: NotesStorage, backup: Backup): Promise<RestoreResult> {
  const have = new Set((await storage.sync.listMeta('page')).map((m) => m.id));
  const { groups: existing } = await storage.loadAll();
  const haveGroups = new Set(existing.map((g) => g.id));
  const newGroups = backup.groups.filter((g) => !haveGroups.has(g.id));
  if (newGroups.length) {
    const known = new Set([...haveGroups, ...newGroups.map((g) => g.id)]);
    // A group whose parent isn't anywhere comes back at the top level.
    await storage.saveGroups([...existing, ...newGroups.map((g) => ({ ...g, parentId: g.parentId && known.has(g.parentId) ? g.parentId : null }))]);
  }
  const groupIds = new Set([...haveGroups, ...newGroups.map((g) => g.id)]);

  for (const img of backup.images) await storage.sync.writeImage(img);

  let pages = 0;
  let skipped = 0;
  for (const r of backup.pages) {
    if (have.has(r.id)) {
      skipped++;
      continue;
    }
    const p = normalizePage(r);
    await storage.sync.insertLocalPage({
      id: p.id,
      title: p.title,
      groupId: p.groupId && groupIds.has(p.groupId) ? p.groupId : null,
      tags: p.tags,
      blocks: p.blocks,
      arrows: p.arrows,
      drawing: p.drawing,
      kind: p.kind,
      dailyDate: p.dailyDate,
      color: p.color,
      created: p.created,
      updated: p.updated,
    });
    pages++;
  }
  return { pages, skipped, groups: newGroups.length };
}

