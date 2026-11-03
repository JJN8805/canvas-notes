/**
 * Daily attendance for checklists. A tracked checklist remembers, for each day, which items were checked, and starts
 * each new day unchecked. From that record the app writes an "Attendance" page: a table per month with ✓ for a day an
 * item was done and ✗ for a day it wasn't, plus a summary with percentages and streaks.
 */
import type { Block, ChecklistBlock, ChecklistTrack, ImageBlock, Page, TableBlock } from '../types';
import { addDays, dailyTitle, dateKey } from './daily';
import { fingerprint, heatmapSvg, heatWindow, type Level } from './heatmap';

/** Ids of the blocks the app writes on an attendance page start with this; anything else on the page is the user's own. */
export const ATT_PREFIX = 'att-';
export const SUMMARY_ID = ATT_PREFIX + 'summary';

const written = (b: ChecklistBlock) => b.items.filter((i) => i.text.trim() !== '');

export function startTracking(b: ChecklistBlock, today: string): ChecklistTrack {
  const items = written(b);
  const done = items.filter((i) => i.done).map((i) => i.id);
  return { start: today, day: today, log: done.length ? { [today]: done } : {}, first: Object.fromEntries(items.map((i) => [i.id, today])) };
}

/** Brings the day's record in line with the checks as they are now. Returns whether anything changed. */
export function reconcile(b: ChecklistBlock): boolean {
  const t = b.track;
  if (!t) return false;
  let changed = false;
  const items = written(b);
  for (const i of items) {
    if (!t.first[i.id]) {
      t.first[i.id] = t.day;
      changed = true;
    }
  }
  const done = items.filter((i) => i.done).map((i) => i.id);
  const cur = t.log[t.day];
  if (done.length) {
    if (!cur || cur.length !== done.length || cur.some((id, k) => id !== done[k])) {
      t.log[t.day] = done;
      changed = true;
    }
  } else if (cur) {
    delete t.log[t.day];
    changed = true;
  }
  return changed;
}

/** At the start of a new day the checks are cleared (yesterday's are already in the log). Returns whether it did. */
export function rollover(b: ChecklistBlock, today: string): boolean {
  const t = b.track;
  if (!t || t.day >= today) return false;
  for (const i of b.items) i.done = false;
  t.day = today;
  return true;
}

/** The dates from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from, n = 0; d <= to && n < 4000; d = addDays(d, 1), n++) out.push(d);
  return out;
}

export interface ItemStats {
  id: string;
  text: string;
  done: number;
  /** Days counted: every day since the item appeared, except today until it's done (today isn't over yet). */
  tracked: number;
  /** Whole-number percentage of tracked days done. */
  rate: number;
  /** Days in a row ending today (if done today) or yesterday. */
  streak: number;
  best: number;
}

const wasDone = (t: ChecklistTrack, id: string, day: string) => !!t.log[day]?.includes(id);

export function itemStats(b: ChecklistBlock, today: string): ItemStats[] {
  const t = b.track;
  if (!t) return [];
  return written(b).map((i) => {
    const from = t.first[i.id] ?? t.start;
    const days = from <= today ? daysBetween(from, today) : [];
    let done = 0, tracked = 0, run = 0, best = 0;
    for (const d of days) {
      const ok = wasDone(t, i.id, d);
      if (d === today && !ok) continue; // not over yet
      tracked++;
      if (ok) {
        done++;
        run++;
        best = Math.max(best, run);
      } else run = 0;
    }
    // `run` is now the streak ending at the last counted day; it only stands if that day is today or yesterday.
    const last = wasDone(t, i.id, today) ? today : addDays(today, -1);
    const streak = wasDone(t, i.id, last) ? run : 0;
    return { id: i.id, text: i.text.trim(), done, tracked, rate: tracked ? Math.round((done / tracked) * 100) : 0, streak, best };
  });
}

/**
 * How much of the list was done on a day, from 0 to 1, or null when the day doesn't count: before tracking started,
 * still to come, or before any item was on the list. Only items already on the list that day are counted.
 */
export function dayShare(b: ChecklistBlock, key: string, today: string, only?: string): number | null {
  const t = b.track;
  if (!t || key < t.start || key > today) return null;
  const items = written(b).filter((i) => (!only || i.id === only) && (t.first[i.id] ?? t.start) <= key);
  if (!items.length) return null;
  return items.filter((i) => wasDone(t, i.id, key)).length / items.length;
}

/** The look of a day in the heatmap. Today shows as an empty outline until something is done (it isn't over yet). */
export function dayLevel(b: ChecklistBlock, key: string, today: string, only?: string): Level {
  if (key > today) return -3;
  const share = dayShare(b, key, today, only);
  if (share === null) return -1;
  if (share === 0) return key === today ? -2 : 0;
  return Math.max(1, Math.ceil(share * 4)) as Level;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The title of the attendance page for a list on a page. */
export const attendanceTitle = (pageTitle: string) => `Attendance: ${pageTitle.trim() || 'To-do list'}`;

/** Display size of a heatmap picture relative to its drawing, so the small squares and labels stay readable on the canvas. */
const HEAT_SCALE = 1.5;
const LEFT = 136;
const GAP = 48;
/** Heatmaps wrap onto a new row rather than run past this x. */
const RIGHT_LIMIT = 1700;
const SUMMARY_W = 680;

export interface AttendanceContent {
  blocks: Block[];
  /** The drawing behind each heatmap picture, by block id. Picture blocks start with no `imageId`; the store stores the SVG and fills it in. */
  svgs: Record<string, string>;
}

/**
 * The blocks of an attendance page, all with `att-` ids so they can be rewritten without touching anything the user adds:
 * a short intro, a GitHub-style heatmap for the whole list with the summary table beside it, and a heatmap per item
 * below, wrapping onto new rows. `source` is the tracked checklist and `link` says where it lives.
 */
export function attendanceBlocks(source: ChecklistBlock, link: { pageId: string; blockId: string }, pageTitle: string, today: string): AttendanceContent {
  const t = source.track;
  if (!t) return { blocks: [], svgs: {} };
  const blocks: Block[] = [];
  const svgs: Record<string, string> = {};
  let z = 0;
  const add = (b: Record<string, unknown>) => blocks.push({ ...b, z: ++z } as unknown as Block);
  add({
    id: ATT_PREFIX + 'title', type: 'text', x: LEFT, y: 48, w: 720, h: 40,
    html: `<h1>${esc(attendanceTitle(pageTitle))}</h1><p>Updated automatically from your checks, since ${esc(dailyTitle(t.start))}. Each square is a day (Monday at the top): the greener, the more you did. Grey is a missed day.</p>`,
  });

  const win = heatWindow(t.start, today);
  const picture = (id: string, title: string, only: string | undefined, x: number, y: number) => {
    const { svg, width, height } = heatmapSvg({ ...win, title, levelOf: (k) => dayLevel(source, k, today, only), legend: only ? 'single' : 'share' });
    const w = Math.round(width * HEAT_SCALE);
    const h = Math.round(height * HEAT_SCALE);
    add({ id, type: 'image', x, y, w, h, imageId: '', aspect: width / height, alt: `Attendance heatmap: ${title}`, heat: fingerprint(svg) } satisfies Partial<ImageBlock> & Record<string, unknown>);
    svgs[id] = svg;
    return { w, h };
  };

  // The whole list, with the summary table next to it (or under it when the picture is wide, i.e. after months of tracking).
  let y = 208;
  const all = picture(ATT_PREFIX + 'hm-all', 'Whole list', undefined, LEFT, y);
  const stats = itemStats(source, today);
  const rows: string[][] = [['Item', 'Done', 'Days', 'Rate', 'Streak', 'Best'], ...stats.map((s) => [s.text, String(s.done), String(s.tracked), `${s.rate}%`, String(s.streak), String(s.best)])];
  const beside = LEFT + all.w + GAP + SUMMARY_W <= RIGHT_LIMIT;
  const tableH = rows.length * 52 + 24;
  add({ id: SUMMARY_ID, type: 'table', x: beside ? LEFT + all.w + GAP : LEFT, y: beside ? y + 36 : y + all.h + GAP, w: SUMMARY_W, h: 72, rows, attendance: link } satisfies Partial<TableBlock> & Record<string, unknown>);
  y += (beside ? Math.max(all.h, tableH + 36) : all.h + GAP + tableH) + GAP;

  // One picture per item, left to right, wrapping.
  let x = LEFT;
  let rowH = 0;
  for (const it of written(source)) {
    const probe = heatmapSvg({ ...win, title: it.text.trim(), levelOf: () => -3, legend: 'single' });
    const w = Math.round(probe.width * HEAT_SCALE);
    if (x > LEFT && x + w > RIGHT_LIMIT) {
      x = LEFT;
      y += rowH + GAP;
      rowH = 0;
    }
    const p = picture(`${ATT_PREFIX}hm-${it.id}`, it.text.trim(), it.id, x, y);
    x += p.w + GAP;
    rowH = Math.max(rowH, p.h);
  }
  return { blocks, svgs };
}

/**
 * Writes fresh attendance content into an attendance page's blocks. Anything the user added is kept, and so is the
 * position and size they gave a generated box: only its text, table or picture is replaced. Returns null when nothing would change.
 * The picture blocks in `generated` must already have their `imageId`.
 */
export function withAttendance(blocks: Block[], generated: Block[]): Block[] | null {
  const old = new Map(blocks.filter((b) => b.id.startsWith(ATT_PREFIX)).map((b) => [b.id, b]));
  const content = (b: Block) =>
    b.type === 'text' ? b.html : b.type === 'table' ? JSON.stringify([b.rows, b.attendance ?? null]) : b.type === 'image' ? `${b.heat}|${b.imageId}` : '';
  const same = old.size === generated.length && generated.every((g) => old.has(g.id) && content(old.get(g.id)!) === content(g));
  if (same) return null;
  const keep = blocks.filter((b) => !b.id.startsWith(ATT_PREFIX));
  const top = keep.reduce((m, b) => Math.max(m, b.z), 0);
  const merged = generated.map((g) => {
    const o = old.get(g.id);
    if (!o) return { ...g, z: g.z + top } as Block;
    if (g.type === 'text') return { ...o, html: g.html } as Block;
    if (g.type === 'table') return { ...o, rows: g.rows, attendance: g.attendance } as Block;
    if (g.type === 'image' && o.type === 'image') return { ...o, imageId: g.imageId, heat: g.heat, aspect: g.aspect, alt: g.alt, h: Math.round(o.w / g.aspect) } as Block;
    return o;
  });
  return [...keep, ...merged];
}

/** The attendance link carried by a page's summary table, if it is an attendance page. */
export function attendanceLink(p: Pick<Page, 'blocks'>): { pageId: string; blockId: string } | null {
  const t = p.blocks.find((b): b is TableBlock => b.id === SUMMARY_ID && b.type === 'table');
  return t?.attendance ?? null;
}

export const todayKey = () => dateKey();
