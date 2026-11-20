/**
 * Workspaces: making them, opening one, and moving or copying pages between them. The rules are pure and tested in `lib/workspaces.ts`.
 * Only the open workspace is held in the notes store (`pages`, `groups`, `cardFolders`, `trash`); everything else stays in the one database,
 * so moving a page is a change of the page's `workspace` in storage followed by a look at the disk, and opening a workspace is a reload.
 */
import { useMemo } from 'react';
import type { Group, GroupColor, Page } from '../types';
import { GROUP_COLORS } from '../types';
import { cloneContent, canArchive } from '../lib/pages';
import { cleanWorkspaceName, listWorkspaces, MAIN, scopeTo, splitGroups, uniqueName, workspaceOf, type WorkspaceInfo } from '../lib/workspaces';
import { newId } from '../lib/util';
import { timed } from '../lib/perf';
import { history } from './history';
import { flushAll, flushPage, flushGroups, get, getStorage, loadTrash, refreshFromDisk, scheduleGroupsSave, set, useNotes } from './notes';
import { MAIN_NAME_KEY, rememberWorkspace, stubOf } from './notes/workspaceMemory';
import { currentRoute, navigate } from '../lib/route';
import { toast } from './ui';

/** The workspaces in order, Main first. */
export function useWorkspaceList(): WorkspaceInfo[] {
  const rows = useNotes((s) => s.workspaces);
  const mainName = useNotes((s) => s.mainName);
  return useMemo(() => listWorkspaces(rows, mainName), [rows, mainName]);
}

/** The id of the open workspace ('' = Main). A window that shows every workspace reports Main. */
export const useActiveWorkspace = (): string => useNotes((s) => s.workspace ?? MAIN);

export const workspaceName = (id: string): string => listWorkspaces(get().workspaces, get().mainName).find((w) => w.id === id)?.name ?? get().mainName;

/** How many pages (not templates) each workspace has, for the switcher: the open one from memory, the others from the short lines. */
export function useWorkspaceCounts(): Record<string, number> {
  const pages = useNotes((s) => s.pages);
  const elsewhere = useNotes((s) => s.elsewhere);
  const active = useActiveWorkspace();
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of Object.values(pages)) if (p.kind !== 'template' && !p.archived) out[active] = (out[active] ?? 0) + 1;
    for (const e of elsewhere) if (e.kind !== 'template' && !e.archived) out[e.workspace] = (out[e.workspace] ?? 0) + 1;
    return out;
  }, [pages, elsewhere, active]);
}

/** A new workspace. Its name is made different from the others'. */
export function createWorkspace(name: string, color?: GroupColor): Group {
  const st = get();
  const taken = listWorkspaces(st.workspaces, st.mainName).map((w) => w.name);
  const used = st.workspaces.map((w) => w.color);
  const g: Group = {
    id: newId(),
    name: uniqueName(name, taken),
    color: color ?? GROUP_COLORS.find((c) => !used.includes(c)) ?? GROUP_COLORS[st.workspaces.length % GROUP_COLORS.length],
    parentId: null,
    scope: 'workspaces',
  };
  set((s) => {
    s.workspaces.push(g);
  });
  scheduleGroupsSave();
  return g;
}

/** Renames a workspace; Main's name is kept on this device only. */
export function renameWorkspace(id: string, name: string): void {
  const clean = cleanWorkspaceName(name, '');
  if (!clean) return;
  if (id === MAIN) {
    set((s) => {
      s.mainName = clean;
    });
    void getStorage().setSetting(MAIN_NAME_KEY, clean).catch(() => {});
    return;
  }
  set((s) => {
    const w = s.workspaces.find((x) => x.id === id);
    if (w) w.name = clean;
  });
  scheduleGroupsSave();
}

export function setWorkspaceColor(id: string, color: GroupColor): void {
  set((s) => {
    const w = s.workspaces.find((x) => x.id === id);
    if (w) w.color = color;
  });
  scheduleGroupsSave();
}

/** Opens a workspace: pending saves are finished, then its pages and groups replace the ones on screen. Remembered on this device. */
export function switchWorkspace(id: string, opts: { go?: boolean } = {}): Promise<boolean> {
  return timed('switchWorkspace', () => switchNow(id, opts));
}
async function switchNow(id: string, opts: { go?: boolean }): Promise<boolean> {
  const st = get();
  const wanted = listWorkspaces(st.workspaces, st.mainName).some((w) => w.id === id) ? id : MAIN;
  if (st.workspace === wanted) return false;
  await flushAll();
  if (opts.go !== false) navigate({ name: 'library' }); // leave an open page before it goes away
  const storage = getStorage();
  const { pages, groups } = await storage.loadAll();
  const stubs = await storage.outline().catch(() => []);
  const split = splitGroups(groups, wanted);
  set((s) => {
    s.workspace = wanted;
    s.pages = Object.fromEntries(scopeTo(pages, wanted).map((p) => [p.id, p]));
    s.groups = split.groups;
    s.cardFolders = split.cardFolders;
    s.workspaces = split.workspaces;
    s.hiddenGroups = split.hiddenGroups;
    s.hiddenCardFolders = split.hiddenCardFolders;
    s.elsewhere = stubs.filter((x) => scopeTo([x], wanted).length === 0);
    s.filter = { kind: 'all' };
    s.query = '';
  });
  rememberWorkspace(wanted);
  await loadTrash();
  return true;
}

/** Whether a page can be moved or copied to another workspace (the same rule as the Archive: not templates, day pages or attendance pages). */
export const canMoveBetweenWorkspaces = (p: Page): boolean => canArchive(p);

/**
 * Moves pages and cards to another workspace. They leave their group (groups belong to a workspace) and keep everything else, including
 * links made to them from boxes. Works from the stored copy, so it is the same wherever the pages are listed. Returns how many moved.
 */
export async function movePagesToWorkspace(ids: string[], target: string, opts: { quiet?: boolean } = {}): Promise<number> {
  const st = get();
  if (!listWorkspaces(st.workspaces, st.mainName).some((w) => w.id === target)) return 0;
  const storage = getStorage();
  await Promise.all(ids.map((id) => flushPage(id)));
  // A page that is open leaves the screen first, so nothing follows it to the other workspace.
  const here = currentRoute();
  if (here.name === 'page' && ids.includes(here.id)) navigate({ name: 'library' });
  const moved: { id: string; from: string; groupId: string | null; title: string }[] = [];
  for (const id of ids) {
    const p = await storage.loadPage(id);
    if (!p || !canMoveBetweenWorkspaces(p) || workspaceOf(p) === target) continue;
    const res = await storage.savePage({ ...p, workspace: target || undefined, groupId: null, updated: Date.now() });
    if (res.ok) moved.push({ id, from: workspaceOf(p), groupId: p.groupId, title: p.title });
  }
  if (!moved.length) return 0;
  for (const m of moved) history.clear(m.id);
  await refreshFromDisk();
  if (!opts.quiet) {
    const name = workspaceName(target);
    toast(
      moved.length === 1 ? `Moved “${moved[0].title.trim() || 'Untitled'}” to ${name}` : `Moved ${moved.length} pages to ${name}`,
      { label: 'Undo', run: () => void putBack(moved) },
      7000,
    );
  }
  return moved.length;
}

async function putBack(moved: { id: string; from: string; groupId: string | null }[]) {
  const storage = getStorage();
  for (const m of moved) {
    const p = await storage.loadPage(m.id);
    if (p) await storage.savePage({ ...p, workspace: m.from || undefined, groupId: m.groupId });
  }
  await refreshFromDisk();
}

/** Puts a copy of pages and cards in another workspace (new ids throughout; pictures are shared). The originals stay where they are. */
export async function copyPagesToWorkspace(ids: string[], target: string, opts: { quiet?: boolean } = {}): Promise<number> {
  const st = get();
  if (!listWorkspaces(st.workspaces, st.mainName).some((w) => w.id === target)) return 0;
  const storage = getStorage();
  await Promise.all(ids.map((id) => flushPage(id)));
  let n = 0;
  for (const id of ids) {
    const p = await storage.loadPage(id);
    if (!p || !canMoveBetweenWorkspaces(p)) continue;
    const now = Date.now();
    const copy: Page = { ...p, ...cloneContent(p), id: newId(), groupId: null, workspace: target || undefined, created: now, updated: now, rev: 0 };
    delete copy.archived;
    if ((await storage.savePage(copy)).ok) n++;
  }
  if (n) {
    await refreshFromDisk();
    if (!opts.quiet) toast(n === 1 ? `Copied to ${workspaceName(target)}` : `Copied ${n} pages to ${workspaceName(target)}`);
  }
  return n;
}

/**
 * Deletes a workspace. Nothing in it is lost: its pages, groups and card folders move to Main. If it is open, Main opens first.
 */
export async function deleteWorkspace(id: string): Promise<boolean> {
  if (id === MAIN || !get().workspaces.some((w) => w.id === id)) return false;
  if (get().workspace === id) await switchWorkspace(MAIN, { go: true });
  await flushAll();
  const storage = getStorage();
  for (const p of (await storage.loadAll()).pages) if (workspaceOf(p) === id) await storage.savePage({ ...p, workspace: undefined });
  const open = get().workspace === MAIN;
  set((s) => {
    const own = (g: Group) => g.workspace === id;
    const moveOver = (g: Group): Group => {
      const { workspace: _w, ...rest } = g;
      return rest;
    };
    const g = s.hiddenGroups.filter(own).map(moveOver);
    const c = s.hiddenCardFolders.filter(own).map(moveOver);
    s.hiddenGroups = s.hiddenGroups.filter((x) => !own(x));
    s.hiddenCardFolders = s.hiddenCardFolders.filter((x) => !own(x));
    if (open) {
      s.groups.push(...g);
      s.cardFolders.push(...c);
    } else {
      s.hiddenGroups.push(...g);
      s.hiddenCardFolders.push(...c);
    }
    s.workspaces = s.workspaces.filter((w) => w.id !== id);
  });
  scheduleGroupsSave();
  await flushGroups();
  await refreshFromDisk();
  toast('Workspace deleted. Its pages are in Main.');
  return true;
}

/** Opens a page wherever it lives: in the open workspace it is just opened; in another one, that workspace opens first. */
export async function openPageAnywhere(pageId: string): Promise<boolean> {
  const st = get();
  if (st.pages[pageId]) {
    navigate({ name: 'page', id: pageId });
    return true;
  }
  const stub = st.elsewhere.find((e) => e.id === pageId);
  if (!stub) return false;
  await switchWorkspace(stub.workspace, { go: false });
  navigate({ name: 'page', id: pageId });
  return true;
}

export { stubOf };
