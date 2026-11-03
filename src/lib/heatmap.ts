/** A GitHub-style contribution calendar, drawn as a small SVG picture (a column per week, a row per weekday, Monday first). */
import { addDays, fromKey } from './daily';

/** What a day looks like: not drawn (-3, still to come), a faint empty square (-1, not tracked), an outline (-2, today, not done yet), missed, or a shade from 1 (a little) to 4 (everything). */
export type Level = -3 | -1 | -2 | 0 | 1 | 2 | 3 | 4;

/** Light to dark green, readable on both the light and the dark page. Missed days are a translucent grey. */
export const SHADES = ['#9be9a8', '#40c463', '#30a14e', '#216e39'] as const;
const MISSED = '#8b949e';
const TEXT = '#838e9a';
/** A little stronger than the labels, still readable on both the light and the dark page. */
const TITLE = '#7d8996';
const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 32;
const TOP = 20;
/** Extra room above the grid for the title, when there is one. */
const TITLE_H = 24;
const FOOT = 26;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Weeks drawn: always a full year, like GitHub, so a new list shows a whole calendar of empty squares to fill. */
export const MAX_WEEKS = 53;

/** The Monday on or before a date. */
export const mondayOf = (key: string): string => addDays(key, -((fromKey(key).getDay() + 6) % 7));

/** The first Monday and the number of weeks to draw: a year ending with the week of `today`, whenever tracking started. */
export function heatWindow(_trackStart: string, today: string): { start: string; weeks: number } {
  return { start: mondayOf(addDays(today, -(MAX_WEEKS - 1) * 7)), weeks: MAX_WEEKS };
}

export interface HeatmapSpec {
  start: string;
  weeks: number;
  levelOf: (key: string) => Level;
  /** Drawn in bold above the grid. */
  title?: string;
  /** 'share' draws the Less…More scale; 'single' (one item) draws Missed and Done. */
  legend: 'share' | 'single';
}

/** The SVG text and its size in its own units. */
export function heatmapSvg(spec: HeatmapSpec): { svg: string; width: number; height: number } {
  const top = TOP + (spec.title ? TITLE_H : 0);
  const width = Math.max(LEFT + spec.weeks * STEP + 4, spec.title ? LEFT + 150 : 0);
  const height = top + 7 * STEP + FOOT;
  const out: string[] = [];
  const text = (x: number, y: number, s: string, anchor = 'start') =>
    out.push(`<text x="${x}" y="${y}" fill="${TEXT}" font-size="10" font-family="system-ui,sans-serif" text-anchor="${anchor}">${s}</text>`);

  if (spec.title) {
    out.push(`<text x="0" y="14" fill="${TITLE}" font-size="13" font-weight="600" font-family="system-ui,sans-serif">${spec.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
  }
  let lastMonth = -1;
  let lastLabelAt = -10;
  for (let w = 0; w < spec.weeks; w++) {
    const monday = addDays(spec.start, w * 7);
    const month = fromKey(monday).getMonth();
    if (month !== lastMonth && w - lastLabelAt >= 3) {
      text(LEFT + w * STEP, top - 10, MONTHS[month]);
      lastLabelAt = w;
    }
    lastMonth = month;
    for (let d = 0; d < 7; d++) {
      const level = spec.levelOf(addDays(monday, d));
      if (level === -3) continue;
      const x = LEFT + w * STEP;
      const y = top + d * STEP;
      if (level === -1) out.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${MISSED}" fill-opacity="0.12"/>`);
      else if (level === -2) out.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${CELL - 1}" height="${CELL - 1}" rx="2" fill="none" stroke="${MISSED}" stroke-opacity="0.6"/>`);
      else if (level === 0) out.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${MISSED}" fill-opacity="0.28"/>`);
      else out.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${SHADES[level - 1]}"/>`);
    }
  }
  [0, 2, 4].forEach((row) => text(0, top + row * STEP + 9, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][row]));

  // Legend, bottom right.
  const ly = top + 7 * STEP + 8;
  const box = (x: number, fill: string, op = 1) => out.push(`<rect x="${x}" y="${ly}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}" fill-opacity="${op}"/>`);
  if (spec.legend === 'share') {
    const x0 = width - 4 - (5 * STEP + 62);
    text(x0, ly + 9, 'Less');
    box(x0 + 28, MISSED, 0.28);
    SHADES.forEach((c, i) => box(x0 + 28 + (i + 1) * STEP, c));
    text(x0 + 28 + 5 * STEP + 4, ly + 9, 'More');
  } else {
    const x0 = width - 4 - 112;
    box(x0, MISSED, 0.28);
    text(x0 + 16, ly + 9, 'Missed');
    box(x0 + 60, SHADES[3]);
    text(x0 + 76, ly + 9, 'Done');
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${out.join('')}</svg>`;
  return { svg, width, height };
}

/** A short stable fingerprint of some text, used to tell whether a picture needs redrawing. */
export function fingerprint(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
