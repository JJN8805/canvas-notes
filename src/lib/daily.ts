import type { Page } from '../types';
import { cleanDate, isTemplate } from './pages';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar date as YYYY-MM-DD (the laptop's own clock and time zone, not UTC). */
export const dateKey = (d: Date = new Date()): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A date key as a local Date at noon, which keeps clear of daylight-saving jumps at midnight. */
export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** The date a number of days away (negative = earlier), across months, years and clock changes. */
export const addDays = (key: string, days: number): string => {
  const d = fromKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
};

/** "Mon, 19 Oct 2026": always in English, so the same date has the same title on every device. */
export function dailyTitle(key: string): string {
  const d = fromKey(key);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export const monthTitle = (year: number, month: number) => `${MONTH_NAMES[month]} ${year}`;

export const WEEK_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The weeks of a month (Monday first), padded with days of the neighbouring months. `month` is 0-11. */
export function monthGrid(year: number, month: number): { key: string; inMonth: boolean; day: number }[][] {
  const first = new Date(year, month, 1, 12);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead, 12);
  const days = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((lead + days) / 7);
  const out: { key: string; inMonth: boolean; day: number }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + i);
      row.push({ key: dateKey(d), inMonth: d.getMonth() === month, day: d.getDate() });
    }
    out.push(row);
  }
  return out;
}

/** The live daily page for a date, if any. */
export const dailyPageFor = (pages: Record<string, Page>, key: string): Page | null =>
  Object.values(pages).find((p) => !isTemplate(p) && p.dailyDate === key) ?? null;

/** Every date that has a daily page. */
export const datesWithPages = (pages: Record<string, Page>): Set<string> =>
  new Set(Object.values(pages).filter((p) => !isTemplate(p) && cleanDate(p.dailyDate)).map((p) => p.dailyDate as string));

/**
 * Two devices can each create the same day's page before they meet. The oldest one (then the smaller id) is the real
 * daily page; the others are returned as `losers`. Every device reaches the same answer from the same pages.
 */
export function findDailyDuplicates(pages: Page[]): { date: string; winner: string; losers: string[] }[] {
  const byDate = new Map<string, Page[]>();
  for (const p of pages) {
    const d = !isTemplate(p) ? cleanDate(p.dailyDate) : null;
    if (d) byDate.set(d, [...(byDate.get(d) ?? []), p]);
  }
  const out: { date: string; winner: string; losers: string[] }[] = [];
  for (const [date, list] of byDate) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.push({ date, winner: sorted[0].id, losers: sorted.slice(1).map((p) => p.id) });
  }
  return out;
}

export const SECOND_COPY = ' (second copy)';

/** Ctrl+Alt+D: opens today's page. */
export const isTodayShortcut = (e: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; repeat?: boolean }) =>
  e.code === 'KeyD' && e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && !e.repeat;
