/**
 * The journal: the daily pages (pages that carry a date) read as a book with one page per day. Pure helpers, tested without the app.
 * Storage is unchanged: a journal page is an ordinary page whose `dailyDate` is set, so sync, backup and templates work as before.
 */
import type { Page } from '../types';
import { blockText } from './util';
import { addDays, fromKey } from './daily';
import { cleanDate, isTemplate, kindOf } from './pages';

export const isJournalPage = (p: Pick<Page, 'dailyDate' | 'kind'>): boolean => kindOf(p) === 'page' && !!cleanDate(p.dailyDate);

export interface JournalEntry {
  date: string;
  page: Page;
}

/** Every day that has a page, newest first. */
export function journalEntries(pages: Record<string, Page>): JournalEntry[] {
  return Object.values(pages)
    .filter((p) => !isTemplate(p) && isJournalPage(p))
    .map((page) => ({ date: page.dailyDate as string, page }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

const linesOf = (page: Pick<Page, 'blocks'>): string[] =>
  [...page.blocks].sort((a, b) => a.y - b.y || a.x - b.x).flatMap((b) => blockText(b).split('\n').map((l) => l.trim()).filter(Boolean));

/** The lines of text a daily template starts every page with ("Focus", "Notes"…), so they can be told apart from what was written. */
export const templateLines = (template: Pick<Page, 'blocks'> | null): Set<string> => new Set(template ? linesOf(template) : []);

/**
 * The first line a person wrote on a page, for the contents list: lines that came with the daily template are skipped, so every day
 * doesn't read "Focus". Empty when nothing has been written yet.
 */
export function entrySnippet(page: Pick<Page, 'blocks'>, max = 90, fromTemplate: ReadonlySet<string> = new Set()): string {
  const line = linesOf(page).find((l) => !fromTemplate.has(l));
  if (!line) return '';
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line;
}

/** Entries whose date, title or words contain every word typed. */
export function filterEntries(entries: JournalEntry[], query: string): JournalEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  return entries.filter((e) => {
    const hay = [e.date, e.page.title, ...e.page.blocks.map(blockText)].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The nearest day with a page before / after `date` (skipping blank days), or null. Entries must be newest first. */
export function neighbourEntries(entries: JournalEntry[], date: string): { earlier: string | null; later: string | null } {
  let earlier: string | null = null;
  let later: string | null = null;
  for (const e of entries) {
    if (e.date < date && (earlier === null || e.date > earlier)) earlier = e.date;
    if (e.date > date && (later === null || e.date < later)) later = e.date;
  }
  return { earlier, later };
}

/** Which way the page turns when going from one day to another: 1 = forward (later), -1 = back. */
export const turnDirection = (from: string, to: string): 1 | -1 => (to >= from ? 1 : -1);

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Wednesday" and "4 November 2026", for the heading of a page. Always English, like the daily page titles. */
export function longDate(key: string): { weekday: string; rest: string } {
  const d = fromKey(key);
  return { weekday: WEEKDAYS[d.getDay()], rest: `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
}

/** "November 2026": the heading of a month in the contents. */
export function monthHeading(key: string): string {
  const d = fromKey(key);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export { addDays };
