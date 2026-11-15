/**
 * The weekly review: what the week (Monday to Sunday) looked like, worked out from the pages already there. Pure code (no app state, no
 * network, no model), so it is tested without the app. Nothing is made until the caller turns the draft into a page.
 */
import type { Block, Page } from '../types';
import { addDays, dailyPageFor, dailyTitle, fromKey } from './daily';
import { entrySnippet } from './journal';
import { attendanceLink, itemStats } from './attendance';
import { isTemplate, kindOf } from './pages';
import { newId } from './util';

export interface WeekDay {
  date: string;
  /** "Mon, 2 Nov" */
  label: string;
  hasPage: boolean;
  /** The first thing written that day (empty when nothing was). */
  written: string;
}
export interface HabitRow {
  /** The page the list is on. */
  list: string;
  text: string;
  /** Days this week it was done, out of the days that counted. */
  done: number;
  counted: number;
  /** Days in a row up to today (or yesterday). */
  streak: number;
}
export interface WeeklyDraft {
  title: string;
  from: string;
  to: string;
  days: WeekDay[];
  doneTasks: string[];
  openTasks: string[];
  habits: HabitRow[];
  /** Pages edited this week (not the daily pages), newest first. */
  touched: { id: string; title: string }[];
  stats: { daysWritten: number; tasksDone: number; tasksOpen: number; pagesTouched: number };
  /** Nothing at all to show for the week. */
  empty: boolean;
}

export const MAX_TASKS = 20;
export const MAX_TOUCHED = 10;

/** The Monday and Sunday of the week that holds `key` (weeks run Monday to Sunday), and the seven dates. */
export function weekRange(key: string): { from: string; to: string; dates: string[] } {
  const from = addDays(key, -((fromKey(key).getDay() + 6) % 7));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return { from, to: dates[6], dates };
}

/** Local midnight at the start of a date (fromKey is noon, to stay clear of clock changes, which is the wrong edge for "edited that day"). */
const dayStart = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Builds the draft for the week that holds `date`. `today` decides which days have not happened yet; `fromTemplate` is the daily template's own lines (see lib/journal.ts). */
export function buildWeekly(pages: Record<string, Page>, date: string, today: string, fromTemplate: ReadonlySet<string> = new Set()): WeeklyDraft {
  const { from, to, dates } = weekRange(date);
  const days: WeekDay[] = dates.map((d) => {
    const p = dailyPageFor(pages, d);
    return { date: d, label: dailyTitle(d).replace(/ \d{4}$/, ''), hasPage: !!p, written: p ? entrySnippet(p, 160, fromTemplate) : '' };
  });

  // To-dos on the week's daily pages: what got done, and what is still open (a task done on a later day is not "open").
  const done = new Map<string, string>();
  const open = new Map<string, string>();
  for (const d of dates) {
    const p = dailyPageFor(pages, d);
    if (!p) continue;
    for (const b of p.blocks) {
      if (b.type !== 'checklist' || b.track) continue; // a daily habit list is counted below, not here
      for (const i of b.items) {
        const t = norm(i.text);
        if (!t) continue;
        const k = t.toLowerCase();
        if (i.done) {
          done.set(k, t);
          open.delete(k);
        } else if (!done.has(k)) open.set(k, t);
      }
    }
  }

  // Daily habit lists (checklists tracked day by day), wherever they are: how often each item was done this week.
  const habits: HabitRow[] = [];
  for (const p of Object.values(pages)) {
    if (kindOf(p) !== 'page' || attendanceLink(p)) continue;
    for (const b of p.blocks) {
      if (b.type !== 'checklist' || !b.track) continue;
      const t = b.track;
      const stats = new Map(itemStats(b, today).map((s) => [s.id, s]));
      for (const i of b.items) {
        const text = norm(i.text);
        if (!text) continue;
        const first = t.first[i.id] ?? t.start;
        let counted = 0, n = 0;
        for (const d of dates) {
          if (d < first || d > today) continue;
          const ok = !!t.log[d]?.includes(i.id);
          if (d === today && !ok) continue; // today is not over yet
          counted++;
          if (ok) n++;
        }
        if (counted) habits.push({ list: p.title.trim() || 'Untitled', text, done: n, counted, streak: stats.get(i.id)?.streak ?? 0 });
      }
    }
  }
  habits.sort((a, b) => b.done / b.counted - a.done / a.counted || a.text.localeCompare(b.text));

  // Pages worked on this week (the daily pages are the Journal's, so they are left out).
  const start = dayStart(from);
  const end = dayStart(addDays(to, 1));
  const touched = Object.values(pages)
    .filter((p) => kindOf(p) === 'page' && !isTemplate(p) && !p.dailyDate && !attendanceLink(p) && p.updated >= start && p.updated < end)
    .sort((a, b) => b.updated - a.updated)
    .slice(0, MAX_TOUCHED)
    .map((p) => ({ id: p.id, title: p.title.trim() || 'Untitled' }));

  const doneTasks = [...done.values()].slice(0, MAX_TASKS);
  const openTasks = [...open.values()].slice(0, MAX_TASKS);
  const daysWritten = days.filter((d) => d.written).length;
  return {
    title: `Week of ${dailyTitle(from)}`,
    from, to, days, doneTasks, openTasks, habits, touched,
    stats: { daysWritten, tasksDone: done.size, tasksOpen: open.size, pagesTouched: touched.length },
    empty: !daysWritten && !done.size && !open.size && !habits.length && !touched.length,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A page title as it must appear inside a [[link]]: the brackets can't be part of the title. */
const linkText = (s: string) => s.replace(/[\[\]]/g, '');

/** The page's text boxes, lists and table for the draft, laid out in two columns on a portrait sheet. Boxes grow with their text, so the heights are only a start. */
export function weeklyBlocks(d: WeeklyDraft): Block[] {
  const out: Block[] = [];
  let z = 1;
  const text = (x: number, y: number, w: number, html: string, lines: number): number => {
    const h = 56 + 34 * lines;
    out.push({ id: newId(), type: 'note', style: 'text', x, y, w, h, z: z++, html } as Block);
    return y + h + 24;
  };
  /** A heading box sits right above the list or table that follows it. */
  const heading = (x: number, y: number, w: number, label: string): number => {
    out.push({ id: newId(), type: 'note', style: 'text', x, y, w, h: 56, z: z++, html: `<h2>${esc(label)}</h2>` } as Block);
    return y + 56 + 8;
  };
  const checklist = (x: number, y: number, w: number, items: string[], done: boolean): number => {
    const h = 56 + 38 * Math.max(items.length, 1);
    out.push({ id: newId(), type: 'checklist', x, y, w, h, z: z++, items: items.map((t) => ({ id: newId(), text: t, done })) } as Block);
    return y + h + 24;
  };
  const L = 80, R = 660, W = 520;
  const range = `${dailyTitle(d.from).replace(/ \d{4}$/, '')} to ${dailyTitle(d.to).replace(/ \d{4}$/, '')}`;
  const s = d.stats;
  const top = text(L, 80, 1100, `<h1>${esc(d.title)}</h1><p>${esc(range)} · ${s.daysWritten} ${s.daysWritten === 1 ? 'day' : 'days'} written · ${s.tasksDone} done · ${s.tasksOpen} still open</p>`, 2);

  // Left column: the days.
  const dayLines = d.days.map((x) => `<li><strong>${esc(x.label)}</strong> ${x.written ? '– ' + esc(x.written) : x.hasPage ? '– <em>nothing written</em>' : '– <em>no page</em>'}</li>`).join('');
  const ly = text(L, top, W, `<h2>The days</h2><ul>${dayLines}</ul>`, 8);
  if (d.touched.length) text(L, ly, W, `<h2>Pages I worked on</h2><ul>${d.touched.map((p) => `<li>[[${esc(linkText(p.title))}]]</li>`).join('')}</ul>`, d.touched.length + 1);

  // Right column: tasks and habits.
  let ry = top;
  if (d.openTasks.length) {
    ry = checklist(R, heading(R, ry, W, 'Still open'), W, d.openTasks, false);
  }
  if (d.doneTasks.length) {
    ry = checklist(R, heading(R, ry, W, 'Done this week'), W, d.doneTasks, true);
  }
  if (d.habits.length) {
    ry = heading(R, ry, W, 'Daily habits');
    const rows = [['Habit', 'Done this week', 'Streak'], ...d.habits.map((h) => [h.text, `${h.done} of ${h.counted}`, h.streak ? `${h.streak} ${h.streak === 1 ? 'day' : 'days'}` : '–'])];
    const h = 44 * rows.length + 16;
    out.push({ id: newId(), type: 'table', x: R, y: ry, w: W, h, z: z++, rows } as Block);
    ry += h;
  }
  if (!d.openTasks.length && !d.doneTasks.length && !d.habits.length) ry = text(R, ry, W, '<h2>Tasks</h2><p>No to-do lists on this week’s daily pages.</p>', 2);
  return out;
}
