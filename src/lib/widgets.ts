/** Desktop widgets: a box or a whole page pinned to the desktop in its own small window. Pure helpers, no I/O. */
import type { Block } from '../types';
import { isSafeId } from '../storage/validate';

export interface WidgetSpec {
  /** Also the window's label: `w-<pageId>-<blockId or "page">`. */
  id: string;
  pageId: string;
  /** The box shown, or null for the whole page. */
  blockId: string | null;
  /** Window position in logical pixels; null = let the system place it. */
  x: number | null;
  y: number | null;
  w: number;
  h: number;
  /** Sits behind other windows like part of the desktop (otherwise it floats above them). */
  bottom: boolean;
}

/** Height of the widget's title strip, added to the box's own height. */
export const WIDGET_HEADER = 30;
export const WIDGET_MIN = { w: 180, h: 120 } as const;
export const WIDGET_MAX = { w: 1600, h: 1200 } as const;
const PAGE_SIZE = { w: 520, h: 420 } as const;

export const widgetIdFor = (pageId: string, blockId: string | null) => `w-${pageId}-${blockId ?? 'page'}`;

/** Window labels are checked again in Rust; this is the same rule. */
export const isWidgetId = (id: unknown): id is string => typeof id === 'string' && /^w-[A-Za-z0-9_-]{1,160}$/.test(id);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function clampSize(w: number, h: number) {
  return { w: Math.round(clamp(w, WIDGET_MIN.w, WIDGET_MAX.w)), h: Math.round(clamp(h, WIDGET_MIN.h, WIDGET_MAX.h)) };
}

/** A new widget for a box (sized like the box) or, with no box, for the whole page. */
export function newWidget(pageId: string, block: Pick<Block, 'id' | 'w' | 'h'> | null): WidgetSpec {
  const size = block ? clampSize(block.w, block.h + WIDGET_HEADER) : PAGE_SIZE;
  return { id: widgetIdFor(pageId, block?.id ?? null), pageId, blockId: block?.id ?? null, x: null, y: null, ...size, bottom: true };
}

/** Reads a stored widget. Anything that isn't a valid widget gives null, so a damaged entry is skipped, never trusted. */
export function parseWidget(raw: string | null): WidgetSpec | null {
  if (!raw) return null;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const blockId = v.blockId === null || v.blockId === undefined ? null : v.blockId;
  if (!isSafeId(v.pageId) || (blockId !== null && !isSafeId(blockId))) return null;
  const id = widgetIdFor(v.pageId, blockId);
  if (v.id !== id || !isWidgetId(id)) return null;
  const { w, h } = clampSize(num(v.w) ?? PAGE_SIZE.w, num(v.h) ?? PAGE_SIZE.h);
  return { id, pageId: v.pageId, blockId, x: num(v.x), y: num(v.y), w, h, bottom: v.bottom !== false };
}

/** The ids in the stored list of widgets, without repeats or anything that isn't a widget id. */
export function parseIndex(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? [...new Set(v.filter(isWidgetId))] : [];
  } catch {
    return [];
  }
}

/** The address a widget window opens (a query, so it works on any page host). */
export const widgetQuery = (s: Pick<WidgetSpec, 'pageId' | 'blockId'>) =>
  `?widget=${encodeURIComponent(s.pageId)}${s.blockId ? `&block=${encodeURIComponent(s.blockId)}` : ''}`;

/** The widget with the window's current position and size (logical pixels) written in. */
export function withGeometry(spec: WidgetSpec, g: { x: number; y: number; w: number; h: number }): WidgetSpec {
  const { w, h } = clampSize(g.w, g.h);
  return { ...spec, x: Number.isFinite(g.x) ? Math.round(g.x) : spec.x, y: Number.isFinite(g.y) ? Math.round(g.y) : spec.y, w, h };
}

/**
 * The logical size to give a window so its web page has `want` CSS pixels, given what it has now (`have`, CSS pixels,
 * measured in the page) and `logical` (the window's current inside size). `ratio` is the page's pixel ratio divided by the
 * window's scale factor; it is 1 on most screens and differs under fractional scaling.
 */
export function fitLogicalSize(
  want: { w: number; h: number },
  have: { w: number; h: number },
  logical: { w: number; h: number },
  ratio: number,
): { w: number; h: number } {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return { w: logical.w + (want.w - have.w) * r, h: logical.h + (want.h - have.h) * r };
}

/** True when the page is far enough from the wanted size to be worth resizing the window. */
export const needsFit = (want: { w: number; h: number }, have: { w: number; h: number }, slack = 6) =>
  Math.abs(want.w - have.w) > slack || Math.abs(want.h - have.h) > slack;
