/**
 * Moving or copying a card folder or section, with every section inside it and every card in them, to another workspace.
 * A section that is moved becomes a folder at the top of the other workspace. Only the open workspace is in the notes store, so the
 * folders leave `cardFolders` for `hiddenCardFolders` (what `flushGroups` needs to keep them) and the cards are changed in storage.
 */
import type { Group, Page } from '../types';
import { cardsOf, cloneContent } from '../lib/pages';
import { withDescendants } from '../lib/groups';
import { listWorkspaces } from '../lib/workspaces';
import { newId } from '../lib/util';
import { history } from './history';
import { flushAll, flushGroups, get, getStorage, refreshFromDisk, scheduleGroupsSave, set } from './notes';
import { toast } from './ui';
import { workspaceName } from './workspaces';

const valid = (target: string) => listWorkspaces(get().workspaces, get().mainName).some((w) => w.id === target) && (get().workspace ?? '') !== target;

/** The folder, its sections (depth-first order kept) and the cards filed in any of them. */
function contents(id: string): { folders: Group[]; cards: Page[] } | null {
  const all = get().cardFolders;
  if (!all.some((f) => f.id === id)) return null;
  const ids = withDescendants(all, id);
  return { folders: all.filter((f) => ids.has(f.id)), cards: cardsOf(get().pages).filter((c) => c.groupId && ids.has(c.groupId)) };
}

const summary = (f: Group, n: { folders: number; cards: number }) => `“${f.name}” (${n.folders - 1} section${n.folders === 2 ? '' : 's'}, ${n.cards} card${n.cards === 1 ? '' : 's'})`;

/** Moves a folder or section with everything in it. Returns how many cards went along, or -1 when it could not be done. */
export async function moveFolderToWorkspace(id: string, target: string): Promise<number> {
  if (!valid(target)) return -1;
  await flushAll();
  const got = contents(id);
  if (!got) return -1;
  const ids = new Set(got.folders.map((f) => f.id));
  const root = got.folders.find((f) => f.id === id) as Group;
  const moved = got.folders.map((f): Group => ({ ...f, workspace: target || undefined, parentId: f.id === id ? null : f.parentId }));
  set((s) => {
    s.cardFolders = s.cardFolders.filter((f) => !ids.has(f.id));
    s.hiddenCardFolders.push(...moved);
  });
  scheduleGroupsSave();
  await flushGroups();
  const storage = getStorage();
  for (const c of got.cards) {
    const p = await storage.loadPage(c.id);
    if (p) await storage.savePage({ ...p, workspace: target || undefined, updated: Date.now() });
    history.clear(c.id);
  }
  await refreshFromDisk();
  toast(`Moved ${summary(root, { folders: got.folders.length, cards: got.cards.length })} to ${workspaceName(target)}`);
  return got.cards.length;
}

/** Puts a copy of a folder or section, with its sections and cards (new ids; pictures are shared), at the top of another workspace. */
export async function copyFolderToWorkspace(id: string, target: string): Promise<number> {
  if (!valid(target)) return -1;
  await flushAll();
  const got = contents(id);
  if (!got) return -1;
  const map = new Map(got.folders.map((f) => [f.id, newId()]));
  const copies = got.folders.map((f): Group => {
    const { etag: _e, synced: _s, deleted: _d, ...rest } = f as Group & { etag?: string; synced?: string | null; deleted?: boolean };
    return { ...rest, id: map.get(f.id) as string, parentId: f.id === id ? null : map.get(f.parentId ?? '') ?? null, workspace: target || undefined };
  });
  set((s) => {
    s.hiddenCardFolders.push(...copies);
  });
  scheduleGroupsSave();
  await flushGroups();
  const storage = getStorage();
  let n = 0;
  for (const c of got.cards) {
    const p = await storage.loadPage(c.id);
    if (!p) continue;
    const now = Date.now();
    const copy: Page = { ...p, ...cloneContent(p), id: newId(), groupId: map.get(p.groupId ?? '') ?? null, workspace: target || undefined, created: now, updated: now, rev: 0 };
    delete copy.archived;
    if ((await storage.savePage(copy)).ok) n++;
  }
  await refreshFromDisk();
  const root = got.folders.find((f) => f.id === id) as Group;
  toast(`Copied ${summary(root, { folders: got.folders.length, cards: n })} to ${workspaceName(target)}`);
  return n;
}
