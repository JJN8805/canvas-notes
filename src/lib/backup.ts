/** Whole-library backup: every page, group and file (pictures, audio, PDFs) in one JSON file, and putting one back. */
import { normalizePage, type NotesStorage, type PageRecord } from '../storage/types';
import type { Group } from '../types';
import { isKnownFileType, isSafeId } from '../storage/validate';
import { pageFileIds } from './files';
import { MAIN, workspaceOf } from './workspaces';

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

/**
 * Collects everything that isn't deleted (trashed pages are left out). With `workspace`, only that workspace: its pages, its groups and
 * card folders, and its own row, so restoring the file elsewhere brings the workspace back whole ('' is Main; templates, which belong to
 * no workspace, go with Main).
 */
export async function buildBackup(storage: NotesStorage, now = Date.now(), opts: { workspace?: string } = {}): Promise<Backup> {
  const all = await storage.loadAll();
  const only = opts.workspace;
  const pages = only === undefined ? all.pages : all.pages.filter((p) => (p.kind === 'template' ? only === MAIN : workspaceOf(p) === only));
  const groups = only === undefined ? all.groups : all.groups.filter((g) => (g.scope === 'workspaces' ? g.id === only : workspaceOf(g) === only));
  const records = (await storage.sync.getRecords('page', pages.map((p) => p.id))) as PageRecord[];
  const used = new Set<string>();
  for (const r of records) for (const id of pageFileIds(r)) used.add(id);
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
  return cleanBackup(raw);
}

/** A backup object (from a .json file or an unpacked archive), checked and repaired: anything that is not safe or not known is left out. */
export function cleanBackup(raw: Partial<Backup>): Backup {
  if (!raw || raw.format !== FORMAT || !Array.isArray(raw.pages)) throw new Error('That file isn’t a Canvas Notes backup.');
  if (raw.version !== 1) throw new Error('That backup was made by a newer version of Canvas Notes. Update the app and try again.');
  const str = (v: unknown) => typeof v === 'string' && v !== '';
  return {
    format: FORMAT,
    version: 1,
    exported: Number(raw.exported) || 0,
    groups: (Array.isArray(raw.groups) ? raw.groups : []).filter((g) => g && str(g.id) && typeof g.name === 'string'),
    pages: raw.pages.filter((p) => p && str(p.id)),
    images: (Array.isArray(raw.images) ? raw.images : []).filter((i) => i && isSafeId(i.id) && isKnownFileType(i.mime) && str(i.data)),
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
  // A page whose workspace is nowhere (a backup made of one workspace of another library, say) would be hidden for good: it goes to Main.
  const workspaces = new Set([...existing, ...newGroups].filter((g) => g.scope === 'workspaces').map((g) => g.id));
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
      sheet: p.sheet,
      cover: p.cover,
      icon: p.icon,
      archived: p.archived,
      workspace: p.workspace && workspaces.has(p.workspace) ? p.workspace : undefined,
      created: p.created,
      updated: p.updated,
    });
    pages++;
  }
  return { pages, skipped, groups: newGroups.length };
}

