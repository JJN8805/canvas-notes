import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Draft } from 'immer';
import type { Arrow, Block, BlockType, Filter, Group, GroupColor, Page, SortKey } from '../types';
import { GROUP_COLORS } from '../types';
import { deepClone, newId } from '../lib/util';
import { isTauri, openStorage, type NotesStorage } from '../storage';
import { history } from './history';
import { effectiveParents, validParents } from '../lib/groups';
import { containingFrame, ungroupedAfterDelete } from '../lib/frames';
import { toast } from './ui';
import { TRASH_DAYS } from '../lib/history';
import type { Snapshot } from '../storage/types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface NotesState {
  status: 'loading' | 'ready' | 'failed';
  error: string | null;
  storageKind: 'desktop' | 'browser';
  storageLocation: string;
  pages: Record<string, Page>;
  /** Deleted pages that can still be restored (`updated` is when they were deleted). */
  trash: Page[];
  groups: Group[];
  save: { state: SaveState; message: string };
  filter: Filter;
  query: string;
  sort: SortKey;
  /** Bumped whenever undo/redo availability may have changed. */
  historyVersion: number;
  /** Groups whose subgroups are folded away in the sidebar. */
  collapsed: string[];
}

export const useNotes = create<NotesState>()(
  immer(() => ({
    status: 'loading' as const,
    error: null,
    storageKind: 'browser' as const,
    storageLocation: '',
    pages: {},
    trash: [],
    groups: [],
    save: { state: 'idle' as SaveState, message: '' },
    filter: { kind: 'all' } as Filter,
    query: '',
    sort: 'updated' as SortKey,
    historyVersion: 0,
    collapsed: [],
  })),
);

const set = useNotes.setState;
const get = useNotes.getState;

let storage: NotesStorage | null = null;
export function getStorage(): NotesStorage {
  if (!storage) throw new Error('Storage is not ready yet');
  return storage;
}

/* ------------------------------------------------------------------ */
/* Startup                                                             */
/* ------------------------------------------------------------------ */

let initPromise: Promise<void> | null = null;

export function initNotes(): Promise<void> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit() {
  try {
    storage = await openStorage();
    const { pages, groups } = await storage.loadAll();
    const location = await storage.location().catch(() => '');
    let collapsed: string[] = [];
    try {
      collapsed = JSON.parse((await storage.getSetting('ui.collapsedGroups')) ?? '[]');
    } catch {
      /* ignore */
    }
    set((s) => {
      s.pages = Object.fromEntries(pages.map((p) => [p.id, p]));
      s.groups = groups;
      s.storageKind = storage!.kind;
      s.storageLocation = location;
      s.collapsed = Array.isArray(collapsed) ? collapsed : [];
      s.status = 'ready';
    });
    // Pages deleted more than 30 days ago are emptied for good (their deletion still syncs).
    await storage.purgeExpiredTrash(Date.now() - TRASH_DAYS * 24 * 3600_000).catch((e) => console.warn('Trash cleanup failed', e));
    await loadTrash();
    // Images deleted from pages are kept until the next launch so undo can bring them back.
    storage.pruneImages(usedImageIds(pages)).catch((e) => console.warn('Image cleanup failed', e));

    window.addEventListener('focus', () => void refreshFromDisk());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushAll();
    });
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      // Finish pending writes before the window closes.
      await getCurrentWindow().onCloseRequested(async () => {
        await flushAll();
      });
    }
  } catch (e) {
    console.error(e);
    set((s) => {
      s.status = 'failed';
      s.error = e instanceof Error ? e.message : String(e);
    });
  }
}

/** Re-reads the Trash list from storage. */
export async function loadTrash() {
  try {
    const trash = await getStorage().listTrash();
    set((s) => {
      s.trash = trash;
    });
  } catch (e) {
    console.warn('Could not read the Trash', e);
  }
}

/** Puts a trashed page back, the same way the delete toast's Undo does. */
export function restoreFromTrash(id: string) {
  const page = get().trash.find((p) => p.id === id);
  if (!page) return;
  set((s) => {
    s.pages[id] = { ...deepClone(page), rev: 0, updated: Date.now() };
    s.trash = s.trash.filter((p) => p.id !== id);
  });
  markDirty(id);
  toast(`Restored “${page.title || 'Untitled'}”`);
}

/** Empties a trashed page for good. */
export async function deleteForever(id: string) {
  try {
    await getStorage().purgePage(id);
  } catch (e) {
    console.error(e);
  }
  await loadTrash();
}

/** Replaces the page's boxes and arrows with an earlier version. Undo (Ctrl+Z) brings the current ones back. */
export async function restoreSnapshot(pageId: string, snap: Snapshot) {
  await flushPage(pageId);
  // Keep what is there now too, so this stays reversible after undo history is gone.
  await getStorage().snapshotPage(pageId, { force: true }).catch((e) => console.warn('History snapshot failed', e));
  mutatePage(pageId, (p) => {
    p.blocks = deepClone(snap.blocks) as Draft<Block>[];
    p.arrows = deepClone(snap.arrows) as Draft<Arrow>[];
  });
  toast('Restored an earlier version. Undo brings back the one you had.');
}

function usedImageIds(pages: Page[]): Set<string> {
  const ids = new Set<string>();
  for (const p of pages) for (const b of p.blocks) if (b.type === 'image') ids.add(b.imageId);
  return ids;
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

const SAVE_DELAY = 500;
const dirty = new Set<string>();
const timers = new Map<string, number>();
const running = new Set<string>();
const rerun = new Set<string>();
let groupsTimer: number | null = null;
let groupsRunning: Promise<void> | null = null;
let lastError = '';

function refreshSaveState() {
  const busy = dirty.size > 0 || running.size > 0 || groupsTimer !== null || groupsRunning !== null;
  const state: SaveState = lastError ? 'error' : busy ? 'saving' : 'saved';
  const cur = get().save;
  if (cur.state !== state || cur.message !== lastError) {
    set((s) => {
      s.save = { state, message: lastError };
    });
  }
}

function markDirty(id: string) {
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
async function resolveConflict(id: string) {
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

function scheduleGroupsSave() {
  if (groupsTimer !== null) clearTimeout(groupsTimer);
  groupsTimer = window.setTimeout(() => void flushGroups(), SAVE_DELAY);
  refreshSaveState();
}

async function flushGroups() {
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

/* ------------------------------------------------------------------ */
/* Page mutations                                                      */
/* ------------------------------------------------------------------ */

export type HistoryMode = 'none' | 'push' | { key: string };

function bumpHistory() {
  set((s) => {
    s.historyVersion += 1;
  });
}

/**
 * The one way pages change. `history` controls undo:
 * 'push' = its own undo step, { key } = merged with consecutive edits that share the key,
 * 'none' = not undoable (title, tags, measurements, live drag frames).
 */
export function mutatePage(
  id: string,
  recipe: (p: Draft<Page>) => void,
  opts: { history?: HistoryMode; touch?: boolean } = {},
) {
  const before = get().pages[id];
  if (!before) return;
  const mode = opts.history ?? 'push';
  set((s) => {
    const p = s.pages[id];
    if (!p) return;
    recipe(p);
    if (opts.touch !== false) p.updated = Date.now();
  });
  const after = get().pages[id];
  if (!after || after === before) return;
  if (mode !== 'none' && (after.blocks !== before.blocks || after.arrows !== before.arrows)) {
    history.record(id, { blocks: before.blocks, arrows: before.arrows }, typeof mode === 'object' ? mode.key : null);
    bumpHistory();
  }
  markDirty(id);
}

export function updateBlock<T extends Block>(
  pageId: string,
  blockId: string,
  recipe: (b: Draft<T>) => void,
  opts?: { history?: HistoryMode; touch?: boolean },
) {
  mutatePage(
    pageId,
    (p) => {
      const b = p.blocks.find((x) => x.id === blockId);
      if (b) recipe(b as Draft<T>);
    },
    opts,
  );
}

export function beginGesture(pageId: string) {
  const p = get().pages[pageId];
  if (p) history.beginGesture(pageId, { blocks: p.blocks, arrows: p.arrows });
}
export function endGesture(pageId: string) {
  const p = get().pages[pageId];
  if (!p) return;
  if (history.endGesture(pageId, { blocks: p.blocks, arrows: p.arrows })) {
    bumpHistory();
    mutatePage(pageId, () => {}, { history: 'none' });
  }
}

export function undo(pageId: string): boolean {
  const cur = get().pages[pageId];
  if (!cur) return false;
  const prev = history.undo(pageId, { blocks: cur.blocks, arrows: cur.arrows });
  if (!prev) return false;
  set((s) => {
    s.pages[pageId].blocks = prev.blocks as Draft<Block>[];
    s.pages[pageId].arrows = prev.arrows as Draft<Arrow>[];
    s.pages[pageId].updated = Date.now();
  });
  bumpHistory();
  markDirty(pageId);
  return true;
}

export function redo(pageId: string): boolean {
  const cur = get().pages[pageId];
  if (!cur) return false;
  const next = history.redo(pageId, { blocks: cur.blocks, arrows: cur.arrows });
  if (!next) return false;
  set((s) => {
    s.pages[pageId].blocks = next.blocks as Draft<Block>[];
    s.pages[pageId].arrows = next.arrows as Draft<Arrow>[];
    s.pages[pageId].updated = Date.now();
  });
  bumpHistory();
  markDirty(pageId);
  return true;
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

type NewBlockFields = Partial<Omit<Block, 'id' | 'type'>> & Record<string, unknown>;

export const BLOCK_DEFAULTS: Record<Exclude<BlockType, 'image'>, () => NewBlockFields> = {
  text: () => ({ w: 280, h: 40, html: '' }),
  checklist: () => ({ w: 288, h: 48, items: [{ id: newId(), text: '', done: false }] }),
  code: () => ({ w: 432, h: 72, code: '' }),
  table: () => ({
    w: 384,
    h: 72,
    rows: [
      ['Column 1', 'Column 2', 'Column 3'],
      ['', '', ''],
      ['', '', ''],
    ],
  }),
  frame: () => ({ w: 360, h: 240, title: 'Frame', color: 'slate', collapsed: false }),
  draw: () => ({ w: 420, h: 300, scene: '', preview: '' }),
};

export const maxZ = (blocks: Block[]) => blocks.reduce((m, b) => Math.max(m, b.z || 0), 0);

export function addBlock(pageId: string, type: BlockType, pos: { x: number; y: number }, extra: NewBlockFields = {}): string {
  const page = get().pages[pageId];
  if (!page) return '';
  const id = newId();
  const base = type === 'image' ? { w: 320, h: 220 } : BLOCK_DEFAULTS[type]();
  const block = {
    ...base,
    ...extra,
    id,
    type,
    x: Math.max(0, Math.round(pos.x)),
    y: Math.max(0, Math.round(pos.y)),
    z: maxZ(page.blocks) + 1,
  } as Block;
  // A box created on top of a frame joins it automatically, same as dropping one in.
  if (type !== 'frame') {
    const dest = containingFrame(page.blocks, block, new Set());
    if (dest) block.frameId = dest.id;
  }
  mutatePage(pageId, (p) => {
    p.blocks.push(block as Draft<Block>);
  });
  return id;
}

export function deleteBlocks(pageId: string, ids: string[]) {
  const page = get().pages[pageId];
  if (!page) return;
  const drop = new Set(ids);
  // Deleting a frame ungroups its contents instead of orphaning them: anything whose
  // frameId chain leads to a deleted frame is reparented to the nearest surviving ancestor.
  const reparent = ungroupedAfterDelete(page.blocks, drop);
  mutatePage(pageId, (p) => {
    p.blocks = p.blocks.filter((b) => !drop.has(b.id));
    for (const b of p.blocks) if (reparent.has(b.id)) b.frameId = reparent.get(b.id) ?? null;
    p.arrows = p.arrows.filter((a) => !drop.has(a.from) && !drop.has(a.to));
  });
}

export function duplicateBlocks(pageId: string, ids: string[]): string[] {
  const page = get().pages[pageId];
  if (!page) return [];
  let z = maxZ(page.blocks);
  const selected = page.blocks.filter((b) => ids.includes(b.id));
  const idMap = new Map(selected.map((b) => [b.id, newId()]));
  const copies = selected.map((b) => {
    const c = deepClone(b) as Block;
    c.id = idMap.get(b.id)!;
    c.x = b.x + 24;
    c.y = b.y + 24;
    c.z = ++z;
    // Keep pointing at the original frame if it wasn't duplicated too; re-point at the
    // new copy if it was, so a duplicated frame+contents stay grouped together.
    if (c.frameId) c.frameId = idMap.get(c.frameId) ?? c.frameId;
    if (c.type === 'checklist') c.items.forEach((i) => (i.id = newId()));
    return c;
  });
  mutatePage(pageId, (p) => {
    p.blocks.push(...(copies as Draft<Block>[]));
  });
  return copies.map((c) => c.id);
}

/** Groups ids by the frameId of the block they currently belong to. */
function byParent(blocks: Block[], ids: string[]): Map<string | null, string[]> {
  const groups = new Map<string | null, string[]>();
  for (const id of ids) {
    const parent = blocks.find((b) => b.id === id)?.frameId ?? null;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent)!.push(id);
  }
  return groups;
}

/** Raise the given blocks above their siblings (within the same frame, if any). Not an undo step. */
export function bringToFront(pageId: string, ids: string[]) {
  const page = get().pages[pageId];
  if (!page || !ids.length) return;
  const groups = byParent(page.blocks, ids);
  const needsChange = [...groups].some(([parent, group]) => {
    const siblings = page.blocks.filter((b) => (b.frameId ?? null) === parent);
    const topIds = [...siblings].sort((a, b) => (b.z || 0) - (a.z || 0)).slice(0, group.length).map((b) => b.id);
    return !group.every((id) => topIds.includes(id));
  });
  if (!needsChange) return;
  mutatePage(
    pageId,
    (p) => {
      for (const [parent, group] of groups) {
        const siblings = p.blocks.filter((b) => (b.frameId ?? null) === parent);
        let z = siblings.reduce((m, b) => Math.max(m, b.z || 0), 0);
        for (const b of p.blocks) if (group.includes(b.id)) b.z = ++z;
      }
    },
    { history: 'none', touch: false },
  );
}

export function sendToBack(pageId: string, ids: string[]) {
  const page = get().pages[pageId];
  if (!page) return;
  const groups = byParent(page.blocks, ids);
  mutatePage(pageId, (p) => {
    for (const [parent, group] of groups) {
      const siblings = p.blocks.filter((b) => (b.frameId ?? null) === parent);
      let z = siblings.reduce((m, b) => Math.min(m, b.z || 0), Infinity) - group.length;
      for (const b of p.blocks) if (group.includes(b.id)) b.z = ++z;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Arrows                                                              */
/* ------------------------------------------------------------------ */

export const maxArrowZ = (arrows: Arrow[]) => arrows.reduce((m, a) => Math.max(m, a.z || 0), 0);

export function addArrow(pageId: string, from: string, to: string): string {
  const page = get().pages[pageId];
  if (!page || from === to) return '';
  const id = newId();
  const arrow: Arrow = { id, from, to, heads: 'one', style: 'solid', z: maxArrowZ(page.arrows) + 1 };
  mutatePage(pageId, (p) => {
    p.arrows.push(arrow as Draft<Arrow>);
  });
  return id;
}

export function updateArrow(pageId: string, arrowId: string, recipe: (a: Draft<Arrow>) => void, opts?: { history?: HistoryMode; touch?: boolean }) {
  mutatePage(
    pageId,
    (p) => {
      const a = p.arrows.find((x) => x.id === arrowId);
      if (a) recipe(a);
    },
    opts,
  );
}

export function deleteArrows(pageId: string, ids: string[]) {
  const drop = new Set(ids);
  mutatePage(pageId, (p) => {
    p.arrows = p.arrows.filter((a) => !drop.has(a.id));
  });
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

export function createPage(partial: Partial<Page> = {}): Page {
  const f = get().filter;
  const now = Date.now();
  const page: Page = {
    id: newId(),
    title: '',
    groupId: f.kind === 'group' ? f.id : null,
    tags: f.kind === 'tag' ? [f.tag] : [],
    blocks: [],
    arrows: [],
    created: now,
    updated: now,
    rev: 0,
    ...partial,
  };
  set((s) => {
    s.pages[page.id] = page;
  });
  markDirty(page.id);
  void flushPage(page.id);
  return page;
}

export function duplicatePage(id: string): Page | null {
  const src = get().pages[id];
  if (!src) return null;
  const c = deepClone(src);
  const idMap = new Map(c.blocks.map((b) => [b.id, newId()]));
  c.blocks.forEach((b) => {
    b.id = idMap.get(b.id)!;
    if (b.frameId) b.frameId = idMap.get(b.frameId) ?? null;
    if (b.type === 'checklist') b.items.forEach((i) => (i.id = newId()));
  });
  c.arrows = c.arrows
    .filter((a) => idMap.has(a.from) && idMap.has(a.to))
    .map((a) => ({ ...a, id: newId(), from: idMap.get(a.from)!, to: idMap.get(a.to)! }));
  return createPage({ ...c, id: newId(), title: `${src.title || 'Untitled'} copy`, created: Date.now(), rev: 0 });
}

/** Deletes a page and offers an undo toast. */
export async function deletePage(id: string) {
  const page = get().pages[id];
  if (!page) return;
  const snapshot = deepClone(page);
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  dirty.delete(id);
  set((s) => {
    delete s.pages[id];
  });
  history.clear(id);
  refreshSaveState();
  try {
    await getStorage().deletePage(id);
    await loadTrash();
  } catch (e) {
    console.error(e);
  }
  toast(`Deleted “${snapshot.title || 'Untitled'}”`, {
    label: 'Undo',
    run: () => {
      set((s) => {
        s.pages[id] = { ...snapshot, rev: 0 };
        s.trash = s.trash.filter((p) => p.id !== id);
      });
      markDirty(id);
    },
  });
}

export function setPageGroup(id: string, groupId: string | null) {
  mutatePage(id, (p) => {
    p.groupId = groupId;
  }, { history: 'none' });
}

export function createExamplePage(): Page {
  const t = newId;
  return createPage({
    title: 'Canvas basics',
    tags: ['guide'],
    groupId: null,
    blocks: [
      {
        id: t(), type: 'text', x: 136, y: 64, w: 432, h: 40, z: 1,
        html: '<h1>Welcome to your canvas</h1><p>Double-click any empty spot to start typing. Move a box with the handle above it and drag its corner to resize. Drag across empty space to select several boxes at once.</p>',
      },
      {
        id: t(), type: 'checklist', x: 624, y: 72, w: 304, h: 48, z: 2,
        items: [
          { id: t(), text: 'Paste or drop an image onto the page', done: false },
          { id: t(), text: 'Select a few boxes and move them together', done: false },
          { id: t(), text: 'Undo a move with Ctrl + Z', done: false },
          { id: t(), text: 'Tag this page from the header', done: false },
        ],
      },
      {
        id: t(), type: 'table', x: 136, y: 304, w: 432, h: 72, z: 3,
        rows: [
          ['Shortcut', 'Action'],
          ['Double-click', 'New text box'],
          ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / redo'],
          ['Delete', 'Remove selected boxes'],
          ['Ctrl + D', 'Duplicate selected boxes'],
          ['Arrow keys', 'Nudge (Shift for 1px)'],
          ['Space + drag', 'Pan the canvas'],
          ['Ctrl + scroll', 'Zoom'],
        ],
      },
      {
        id: t(), type: 'code', x: 624, y: 312, w: 304, h: 72, z: 4,
        code: '{\n  "type": "text",\n  "x": 136, "y": 64,\n  "w": 432\n}',
      },
      {
        id: t(), type: 'text', x: 624, y: 472, w: 304, h: 40, z: 5, fill: true,
        html: '<p>Every box stores its own position, so nothing moves unless you move it.</p>',
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Groups & library view                                               */
/* ------------------------------------------------------------------ */

export function createGroup(name: string, parentId: string | null = null): Group {
  const groups = get().groups;
  const parent = parentId ? groups.find((g) => g.id === parentId) : undefined;
  // A subgroup starts with its parent's colour; a new top-level group gets an unused one.
  const used = groups.map((g) => g.color);
  const color: GroupColor =
    parent?.color ?? GROUP_COLORS.find((c) => !used.includes(c)) ?? GROUP_COLORS[groups.length % GROUP_COLORS.length];
  const g: Group = { id: newId(), name: name.trim().slice(0, 60), color, parentId: parent ? parent.id : null };
  set((s) => {
    s.groups.push(g);
    if (parent) s.collapsed = s.collapsed.filter((id) => id !== parent.id); // show the new subgroup
  });
  scheduleGroupsSave();
  return g;
}

export function updateGroup(id: string, patch: Partial<Pick<Group, 'name' | 'color'>>) {
  set((s) => {
    const g = s.groups.find((x) => x.id === id);
    if (g) Object.assign(g, patch);
  });
  scheduleGroupsSave();
}

/** Moves a group (with everything inside it) into another group, or to the top level. */
export function moveGroup(id: string, parentId: string | null): boolean {
  if (parentId && !validParents(get().groups, id).some((g) => g.id === parentId)) return false;
  set((s) => {
    const g = s.groups.find((x) => x.id === id);
    if (g) g.parentId = parentId;
    if (parentId) s.collapsed = s.collapsed.filter((x) => x !== parentId);
  });
  scheduleGroupsSave();
  return true;
}

/**
 * Deletes one group. Nothing inside it is lost: its subgroups and pages move
 * up into its parent group (or to the top level / Ungrouped).
 */
export function deleteGroup(id: string) {
  const groups = get().groups;
  const parentId = effectiveParents(groups).get(id) ?? null;
  set((s) => {
    for (const g of s.groups) if (g.parentId === id) g.parentId = parentId;
    s.groups = s.groups.filter((g) => g.id !== id);
    if (s.filter.kind === 'group' && s.filter.id === id) s.filter = parentId ? { kind: 'group', id: parentId } : { kind: 'all' };
  });
  for (const p of Object.values(get().pages)) if (p.groupId === id) setPageGroup(p.id, parentId);
  scheduleGroupsSave();
}

export function toggleCollapsed(id: string) {
  set((s) => {
    s.collapsed = s.collapsed.includes(id) ? s.collapsed.filter((x) => x !== id) : [...s.collapsed, id];
  });
  void getStorage().setSetting('ui.collapsedGroups', JSON.stringify(get().collapsed)).catch(() => {});
}

export function setFilter(filter: Filter) {
  set((s) => {
    s.filter = filter;
  });
}
export function setQuery(query: string) {
  set((s) => {
    s.query = query;
  });
}
export function setSort(sort: SortKey) {
  set((s) => {
    s.sort = sort;
  });
}

export { history };
