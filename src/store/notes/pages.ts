import { Page } from '../../types';
import { dailyPageFor, dailyTitle, findDailyDuplicates, SECOND_COPY } from '../../lib/daily';
import { cloneContent, isTemplate, resolveDailyTemplate, templateFrom } from '../../lib/pages';
import { setDailyTemplate, usePrefs } from '../prefs';
import { deepClone, newId } from '../../lib/util';
import { history } from '../history';
import { toast } from '../ui';
import { get, getStorage, peekStorage, set } from './state';
import { loadTrash } from './init';
import { dirty, flushPage, markDirty, refreshSaveState, scheduleGroupsSave, timers } from './save';
import { mutatePage } from './mutate';

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

/**
 * A new page that starts as an independent copy of a template (or blank for null): new ids throughout,
 * titled with the template's name, in the group and tags of the current library view. Nothing links back to the template.
 */
export function createPageFromTemplate(templateId: string | null, partial: Partial<Page> = {}): Page | null {
  if (templateId === null) return createPage(partial);
  const tpl = get().pages[templateId];
  if (!tpl || !isTemplate(tpl)) return null;
  return createPage({ ...cloneContent(tpl), title: tpl.title, color: tpl.color ?? null, kind: 'page', dailyDate: null, ...partial });
}

/** Keeps a copy of the page's layout and boxes as a template. */
export function saveAsTemplate(pageId: string, name: string): Page | null {
  const src = get().pages[pageId];
  if (!src) return null;
  const tpl = templateFrom(src, name.trim() || src.title || 'Untitled template');
  set((s) => {
    s.pages[tpl.id] = tpl;
  });
  markDirty(tpl.id);
  void flushPage(tpl.id);
  return tpl;
}

/** A new, empty template, ready to be filled in. */
export function createTemplate(name = 'New template'): Page {
  const now = Date.now();
  const tpl: Page = { id: newId(), kind: 'template', title: name, groupId: null, tags: [], blocks: [], arrows: [], created: now, updated: now, rev: 0 };
  set((s) => {
    s.pages[tpl.id] = tpl;
  });
  markDirty(tpl.id);
  void flushPage(tpl.id);
  return tpl;
}

export function renameTemplate(id: string, name: string) {
  const t = get().pages[id];
  if (!t || !isTemplate(t) || !name.trim() || t.title === name.trim()) return;
  mutatePage(id, (p) => {
    p.title = name.trim();
  }, { history: 'none' });
}

export function duplicateTemplate(id: string): Page | null {
  const src = get().pages[id];
  if (!src || !isTemplate(src)) return null;
  const copy = templateFrom(src, `${src.title || 'Untitled template'} copy`);
  set((s) => {
    s.pages[copy.id] = copy;
  });
  markDirty(copy.id);
  void flushPage(copy.id);
  return copy;
}

/**
 * Deletes a template for good (the deletion syncs). Templates skip the trash: pages made from one
 * are copies, so they are unaffected. If it was the daily template, the daily page goes back to its default.
 */
export async function deleteTemplate(id: string) {
  const t = get().pages[id];
  if (!t || !isTemplate(t)) return;
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  dirty.delete(id);
  set((s) => {
    delete s.pages[id];
  });
  history.clear(id);
  refreshSaveState();
  if (usePrefs.getState().dailyTemplate === id) setDailyTemplate(null, peekStorage());
  try {
    await getStorage().deletePage(id);
    await getStorage().purgePage(id);
  } catch (e) {
    console.error(e);
  }
}

export function chooseDailyTemplate(value: string | null) {
  setDailyTemplate(value, peekStorage());
}

export const DAILY_GROUP_ID = 'group-daily';

/** The "Daily" group, created when first needed. It has the same id on every device, so two devices never make two. */
export function ensureDailyGroup(): string {
  if (get().groups.some((g) => g.id === DAILY_GROUP_ID)) return DAILY_GROUP_ID;
  set((s) => {
    s.groups.push({ id: DAILY_GROUP_ID, name: 'Daily', color: 'ultra', parentId: null });
  });
  scheduleGroupsSave();
  return DAILY_GROUP_ID;
}

/**
 * The page for a day (YYYY-MM-DD): the one that already exists, or a new one made from the daily template,
 * titled with the date and filed in the Daily group. Only ever called because you opened that day.
 */
export function openDailyPage(date: string): Page {
  const existing = dailyPageFor(get().pages, date);
  if (existing) return existing;
  const fields = { title: dailyTitle(date), dailyDate: date, groupId: ensureDailyGroup(), tags: [] as string[] };
  const tpl = resolveDailyTemplate(get().pages, usePrefs.getState().dailyTemplate);
  return (tpl && createPageFromTemplate(tpl.id, fields)) || createPage(fields);
}

/**
 * Where two live pages claim the same date, the oldest stays the daily page and the rest become ordinary pages
 * titled "… (second copy)", still in the Daily group. Returns how many were changed.
 */
export function resolveDailyDuplicates(): number {
  let n = 0;
  for (const { losers } of findDailyDuplicates(Object.values(get().pages))) {
    for (const id of losers) {
      mutatePage(id, (p) => {
        p.dailyDate = null;
        if (!p.title.endsWith(SECOND_COPY)) p.title = `${p.title || 'Untitled'}${SECOND_COPY}`;
      }, { history: 'none' });
      n++;
    }
  }
  return n;
}

export function duplicatePage(id: string): Page | null {
  const src = get().pages[id];
  if (!src) return null;
  // A copy is a normal page, even of a template, and never takes over a daily page's date.
  return createPage({ ...deepClone(src), ...cloneContent(src), kind: 'page', dailyDate: null, id: newId(), title: `${src.title || 'Untitled'} copy`, created: Date.now(), rev: 0 });
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

