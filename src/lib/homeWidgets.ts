/**
 * The phone's home screen widgets (pure). The app publishes a *snapshot* (to-do lists and the words of recent pages) for the widgets to
 * show; the widgets queue what the person does (tick, add, quick note, open) and the app applies it later. Everything coming back from
 * the widgets is checked here before it touches a note.
 */
import type { Block, ChecklistBlock, Page } from '../types';
import { isSafeId } from '../storage/validate';
import { cleanCapture, INBOX_TITLE } from './capture';
import { dateKey } from './daily';
import { blockPlainText } from './pageText';
import { isArchived, kindOf } from './pages';
import { sheetForContent } from './sheet';
import { workspaceOf } from './workspaces';

export interface WidgetItem {
  /** `pageId|blockId|itemId` */
  ref: string;
  text: string;
  done: boolean;
  from?: string;
}
export interface WidgetList {
  /** `today`, or `pageId|blockId` */
  id: string;
  title: string;
  items: WidgetItem[];
}
export interface WidgetSnapshot {
  v: 1;
  lists: WidgetList[];
  pages: { id: string; title: string; text: string }[];
}

export type WidgetAction =
  | { id: string; at: number; type: 'toggle'; itemId: string; done: boolean }
  | { id: string; at: number; type: 'add'; list: string; text: string }
  | { id: string; at: number; type: 'capture'; text: string }
  | { id: string; at: number; type: 'open'; page: string };

const LIMITS = { today: 50, lists: 60, items: 100, pages: 60, itemText: 300, pageText: 1200 } as const;

const title = (p: Page) => p.title.trim() || 'Untitled';
const usable = (p: Page) => kindOf(p) !== 'template' && !isArchived(p);
const lists = (p: Page): ChecklistBlock[] => p.blocks.filter((b): b is ChecklistBlock => b.type === 'checklist');

export const emptySnapshot = (): WidgetSnapshot => ({ v: 1, lists: [], pages: [] });

/** What the widgets show, from every page of every workspace (`names`: workspace id → name, used when there is more than one). */
export function buildSnapshot(pages: readonly Page[], names: ReadonlyMap<string, string>): WidgetSnapshot {
  const mine = pages.filter(usable).sort((a, b) => b.updated - a.updated);
  const place = (p: Page) => (names.size > 1 ? `${title(p)} · ${names.get(workspaceOf(p)) ?? ''}` : title(p)).replace(/ · $/, '');
  const today: WidgetItem[] = [];
  const out: WidgetList[] = [];
  for (const p of mine) {
    const own = lists(p).filter((b) => isSafeId(b.id) && isSafeId(p.id));
    own.forEach((b, n) => {
      const items = b.items
        .filter((i) => isSafeId(i.id) && i.text.trim())
        .map((i) => ({ ref: `${p.id}|${b.id}|${i.id}`, text: i.text.trim().slice(0, LIMITS.itemText), done: i.done }));
      for (const i of items) if (!i.done && today.length < LIMITS.today) today.push({ ...i, from: place(p) });
      if (out.length < LIMITS.lists) out.push({ id: `${p.id}|${b.id}`, title: own.length > 1 ? `${place(p)} (${n + 1})` : place(p), items: items.slice(0, LIMITS.items) });
    });
  }
  return {
    v: 1,
    lists: [{ id: 'today', title: 'To do', items: today }, ...out],
    pages: mine
      .filter((p) => kindOf(p) === 'page' && isSafeId(p.id))
      .slice(0, LIMITS.pages)
      .map((p) => ({ id: p.id, title: place(p), text: p.blocks.map(blockPlainText).filter((t) => t.trim()).join('\n').slice(0, LIMITS.pageText) })),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The queued actions as the widgets wrote them. Anything that is not exactly an action is left out (and so acknowledged away). */
export function parseActions(raw: unknown): { actions: WidgetAction[]; rejected: string[] } {
  const actions: WidgetAction[] = [];
  const rejected: string[] = [];
  let list: unknown;
  try {
    list = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { actions, rejected };
  }
  if (!Array.isArray(list)) return { actions, rejected };
  for (const a of list.slice(0, 500)) {
    if (!isObj(a) || !isSafeId(a.id)) continue;
    const base = { id: a.id, at: typeof a.at === 'number' && Number.isFinite(a.at) ? a.at : Date.now() };
    const itemId = typeof a.ref === 'string' ? a.ref.split('|')[2] : undefined;
    const text = cleanCapture(a.text);
    if (a.type === 'toggle' && isSafeId(itemId) && typeof a.done === 'boolean') actions.push({ ...base, type: 'toggle', itemId, done: a.done });
    else if (a.type === 'add' && text && typeof a.list === 'string' && (a.list === 'today' || (a.list.split('|').length === 2 && a.list.split('|').every(isSafeId))))
      actions.push({ ...base, type: 'add', list: a.list, text: text.replace(/\s*\n\s*/g, ' ') });
    else if (a.type === 'capture' && text) actions.push({ ...base, type: 'capture', text });
    else if (a.type === 'open' && isSafeId(a.page)) actions.push({ ...base, type: 'open', page: a.page });
    else rejected.push(a.id);
  }
  return { actions, rejected };
}

/** The id an item added on a widget gets (the widget uses the same one, so a tick made before the app ran finds it). */
export const addedItemId = (actionId: string) => 'w' + actionId.replace(/-/g, '');

/** Ticks or unticks one item, wherever it is now. Null when nothing needs saving (gone, already so, or an old tick on a daily list). */
export function applyToggle(pages: readonly Page[], a: Extract<WidgetAction, { type: 'toggle' }>, today: string): Page | null {
  for (const p of pages) {
    for (const b of lists(p)) {
      const item = b.items.find((i) => i.id === a.itemId);
      if (!item) continue;
      // A daily-tracked list starts fresh each day: yesterday's tick must not count for today.
      if (item.done === a.done || (b.track && dateKey(new Date(a.at)) !== today)) return null;
      return { ...p, updated: Math.max(p.updated, a.at), blocks: p.blocks.map((x) => (x.id === b.id ? { ...b, items: b.items.map((i) => (i.id === a.itemId ? { ...i, done: a.done } : i)) } : x)) };
    }
  }
  return null;
}

export type AddResult = { page: Page; created: boolean } | null;

/**
 * Adds a to-do to the list it was typed on; when that list is gone (or it was the combined "To do" list), to the Inbox page of the
 * workspace, so nothing typed is ever lost. Null when it is already there.
 */
export function applyAdd(pages: readonly Page[], a: Extract<WidgetAction, { type: 'add' }>, workspace: string, mkId: () => string): AddResult {
  const id = addedItemId(a.id);
  if (pages.some((p) => lists(p).some((b) => b.items.some((i) => i.id === id)))) return null;
  const item = { id, text: a.text, done: false };
  const append = (p: Page, blockId: string): Page => ({
    ...p,
    updated: Math.max(p.updated, a.at),
    blocks: p.blocks.map((x) => (x.id === blockId && x.type === 'checklist' ? { ...x, items: [...x.items.filter((i) => i.text.trim()), item] } : x)),
  });
  if (a.list !== 'today') {
    const [pageId, blockId] = a.list.split('|');
    const p = pages.find((x) => x.id === pageId && usable(x));
    if (p && lists(p).some((b) => b.id === blockId)) return { page: append(p, blockId), created: false };
  }
  const inbox = pages.find((p) => usable(p) && !p.dailyDate && workspaceOf(p) === workspace && p.title.trim() === INBOX_TITLE);
  const existing = inbox ? lists(inbox)[0] : undefined;
  if (inbox && existing) return { page: append(inbox, existing.id), created: false };
  const y = inbox?.blocks.reduce((m, b) => Math.max(m, b.y + (b.ah ?? b.h) + 24), 0) ?? 40;
  const z = (inbox?.blocks.reduce((m, b) => Math.max(m, b.z || 0), 0) ?? 0) + 1;
  const list: Block = { id: mkId(), type: 'checklist', x: 40, y, w: 288, h: 48, z, items: [item] };
  if (inbox) return { page: { ...inbox, blocks: [...inbox.blocks, list], updated: Math.max(inbox.updated, a.at) }, created: false };
  const page: Page = { id: mkId(), title: INBOX_TITLE, groupId: null, tags: [], blocks: [list], arrows: [], created: a.at, updated: a.at, rev: 0, sheet: sheetForContent([list]), ...(workspace ? { workspace } : {}) };
  return { page, created: true };
}
