/**
 * Finite pages. A page either has no edges (the original canvas, `sheet` absent) or a *sheet*: one rectangle, in canvas
 * coordinates, that every box stays inside. Older pages have no sheet, so they stay infinite and older app versions,
 * which ignore the field, still open every page as an infinite canvas.
 */
import type { Page, Sheet } from '../types';
import { blockHeight } from './util';

type Box = { x: number; y: number; w: number; h: number };

/** A4 at 150 dpi: about what fits a laptop screen at 100% zoom when scrolled a little. */
export const SHEET_PORTRAIT: Sheet = { x: 0, y: 0, w: 1240, h: 1754 };
export const SHEET_LANDSCAPE: Sheet = { x: 0, y: 0, w: 1754, h: 1240 };
export const SHEET_MIN = 320;
export const SHEET_MAX = 20000;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A usable sheet, or null (= infinite). Stored data may be anything. */
export function cleanSheet(v: unknown): Sheet | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (!num(s.x) || !num(s.y) || !num(s.w) || !num(s.h)) return null;
  if (s.w < SHEET_MIN || s.h < SHEET_MIN || s.w > SHEET_MAX || s.h > SHEET_MAX) return null;
  if (Math.abs(s.x) > 1e7 || Math.abs(s.y) > 1e7) return null;
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

/** `base`, grown (never shrunk, never moved right or down) until it also covers every box. */
export function sheetCovering(base: Sheet, boxes: readonly Box[]): Sheet {
  let minX = base.x, minY = base.y, maxX = base.x + base.w, maxY = base.y + base.h;
  for (const b of boxes) {
    if (!num(b.x) || !num(b.y) || !num(b.w) || !num(b.h)) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  // Boxes can only be so far apart before a sheet stops being a sheet: past the limit the page stays infinite.
  return cleanSheet({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }) ?? base;
}

/** The sheet a page gets when it is made finite: the portrait sheet, grown to hold what is already on it. */
export function sheetForContent(boxes: readonly Box[], base: Sheet = SHEET_PORTRAIT): Sheet {
  return sheetCovering(base, boxes);
}

/** Moves a box (and, if it is bigger than the sheet, shrinks it) so it lies inside the sheet. Changes nothing when it already does. */
export function keepInside(b: Box, s: Sheet): void {
  if (!num(b.x) || !num(b.y) || !num(b.w) || !num(b.h)) return;
  if (b.w > s.w) b.w = s.w;
  if (b.h > s.h) b.h = s.h;
  if (b.x < s.x) b.x = s.x;
  else if (b.x + b.w > s.x + s.w) b.x = s.x + s.w - b.w;
  if (b.y < s.y) b.y = s.y;
  else if (b.y + b.h > s.y + s.h) b.y = s.y + s.h - b.h;
}

/** Pulls every box of the page inside its sheet. Does nothing on an infinite page. */
export function keepPageInside(p: Pick<Page, 'blocks' | 'sheet'>): void {
  const s = p.sheet;
  if (!s) return;
  for (const b of p.blocks) {
    // A box that grows with its text counts at the height it has been measured at, not the one it started with.
    const box = { x: b.x, y: b.y, w: b.w, h: blockHeight(b) };
    const h = box.h;
    keepInside(box, s);
    if (box.x !== b.x) b.x = box.x;
    if (box.y !== b.y) b.y = box.y;
    if (box.w !== b.w) b.w = box.w;
    if (box.h !== h) b.h = Math.min(b.h, box.h);
  }
}

/** The part of a drawing that lies on the sheet (the whole drawing on an infinite page); null when none of it does. */
export function inkOnSheet(ink: Box, s: Sheet | null | undefined): Box | null {
  if (!s) return ink;
  const x = Math.max(ink.x, s.x), y = Math.max(ink.y, s.y);
  const r = Math.min(ink.x + ink.w, s.x + s.w), b = Math.min(ink.y + ink.h, s.y + s.h);
  return r > x && b > y ? { x, y, w: r - x, h: b - y } : null;
}

/** CSS `clip-path` that hides what lies outside the sheet of a drawing placed at `ink`. */
export const inkClipPath = (ink: Box, s: Box) =>
  `inset(${Math.max(0, s.y - ink.y)}px ${Math.max(0, ink.x + ink.w - (s.x + s.w))}px ${Math.max(0, ink.y + ink.h - (s.y + s.h))}px ${Math.max(0, s.x - ink.x)}px)`;

/** One more sheet's worth of room below (the page gets taller; nothing on it moves). */
export const taller = (s: Sheet): Sheet => cleanSheet({ ...s, h: s.h + Math.round(SHEET_PORTRAIT.h / 2) }) ?? s;
export const wider = (s: Sheet): Sheet => cleanSheet({ ...s, w: s.w + Math.round(SHEET_PORTRAIT.w / 2) }) ?? s;

export const sameSheet = (a: Sheet | null | undefined, b: Sheet | null | undefined) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
