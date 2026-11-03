import { Page } from '../../types';
import { deepClone, newId } from '../../lib/util';
import { history } from '../history';
import { toast } from '../ui';
import { SaveState, get, getStorage, peekStorage, set } from './state';
import { bumpHistory } from './mutate';

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

export const SAVE_DELAY = 500;
export const dirty = new Set<string>();
export const timers = new Map<string, number>();
export const running = new Set<string>();
export const rerun = new Set<string>();
let groupsTimer: number | null = null;
let groupsRunning: Promise<void> | null = null;
let lastError = '';

export function refreshSaveState() {
  const busy = dirty.size > 0 || running.size > 0 || groupsTimer !== null || groupsRunning !== null;
  const state: SaveState = lastError ? 'error' : busy ? 'saving' : 'saved';
  const cur = get().save;
  if (cur.state !== state || cur.message !== lastError) {
    set((s) => {
      s.save = { state, message: lastError };
    });
  }
}

export function markDirty(id: string) {
  dirty.add(id);
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.set(id, window.setTimeout(() => void flushPage(id), SAVE_DELAY));
  refreshSaveState();
}

export async function flushPage(id: string): Promise<void> {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  if (!dirty.has(id)) return;
  if (running.has(id)) {
    rerun.add(id);
    return;
  }
  running.add(id);
  try {
    do {
      rerun.delete(id);
      dirty.delete(id);
      const page = get().pages[id];
      if (!page) break;
      const res = await getStorage().savePage(page);
      if (res.ok) {
        set((s) => {
          if (s.pages[id]) s.pages[id].rev = res.rev;
        });
        lastError = '';
      } else {
        await resolveConflict(id);
      }
    } while (rerun.has(id) || (dirty.has(id) && !timers.has(id)));
  } catch (e) {
    console.error('Save failed', e);
    dirty.add(id);
    lastError = 'Couldn’t save. Your changes are kept and will be retried.';
    window.setTimeout(() => markDirty(id), 3000);
  } finally {
    running.delete(id);
    refreshSaveState();
  }
}

export async function flushAll(): Promise<void> {
  const ids = new Set([...dirty, ...timers.keys()]);
  await Promise.all([...ids].map((id) => flushPage(id)));
  await flushGroups();
}

/** Another window saved this page first: keep theirs, keep ours as a copy. */
export async function resolveConflict(id: string) {
  const local = get().pages[id];
  const disk = await getStorage().loadPage(id);
  if (!local) return;
  const copy: Page = {
    ...deepClone(local),
    id: newId(),
    title: `${local.title || 'Untitled'} (conflicted copy)`,
    rev: 0,
    updated: Date.now(),
  };
  set((s) => {
    if (disk) s.pages[id] = disk;
    else delete s.pages[id];
    s.pages[copy.id] = copy;
  });
  history.clear(id);
  bumpHistory();
  markDirty(copy.id);
  toast('This page was changed in another window. Your version was saved as a separate copy.');
}

/** Pick up changes made in another window when this one regains focus. */
export async function refreshFromDisk() {
  const storage = peekStorage();
  if (!storage || get().status !== 'ready') return;
  const { pages, groups } = await storage.loadAll();
  const onDisk = new Map(pages.map((p) => [p.id, p]));
  const busy = (id: string) => dirty.has(id) || running.has(id) || timers.has(id);
  const replaced: string[] = [];
  set((s) => {
    for (const p of pages) {
      const cur = s.pages[p.id];
      if (busy(p.id)) continue;
      if (!cur || p.rev > cur.rev) {
        s.pages[p.id] = p;
        if (cur) replaced.push(p.id);
      }
    }
    for (const id of Object.keys(s.pages)) {
      if (!onDisk.has(id) && !busy(id) && s.pages[id].rev > 0) delete s.pages[id];
    }
    if (groupsTimer === null && groupsRunning === null) s.groups = groups;
  });
  if (replaced.length) {
    replaced.forEach((id) => history.clear(id));
    bumpHistory();
  }
}

export function scheduleGroupsSave() {
  if (groupsTimer !== null) clearTimeout(groupsTimer);
  groupsTimer = window.setTimeout(() => void flushGroups(), SAVE_DELAY);
  refreshSaveState();
}

export async function flushGroups() {
  if (groupsTimer === null) return groupsRunning ?? undefined;
  clearTimeout(groupsTimer);
  groupsTimer = null;
  if (groupsRunning) await groupsRunning;
  groupsRunning = (async () => {
    try {
      await getStorage().saveGroups(deepClone(get().groups));
    } catch (e) {
      console.error(e);
      lastError = 'Couldn’t save groups.';
    }
  })();
  await groupsRunning;
  groupsRunning = null;
  refreshSaveState();
}

