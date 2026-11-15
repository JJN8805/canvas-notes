/**
 * Tidying a page's layout. Pure code (no app state, no network, no model), so it is tested without the app.
 *
 * The boxes are not rewritten, only moved (and a few resized): edges that are nearly lined up are lined up, boxes that overlap are
 * separated by moving the lower one down, and a finite page grows if the result no longer fits. A frame moves together with everything
 * inside it, and what is inside a frame keeps its place within it. The result is a *proposal*: nothing changes until the caller applies it.
 */
import type { Block, Page, Sheet } from '../types';
import { blockHeight, snap } from './util';
import { frameDescendants } from './frames';
import { sheetCovering, sameSheet } from './sheet';

/** Edges closer than this (canvas pixels) count as "meant to line up". */
export const ALIGN_TOLERANCE = 20;
/** The gap left under a box that had to be moved out of the way. */
export const GAP = 24;
const MIN_OVERLAP = 4;

export interface TidyMove {
  x: number;
  y: number;
  /** Only for boxes that were made the same width as their neighbours. */
  w?: number;
}

export interface TidyResult {
  /** New position (and sometimes width) of every box that changes, by id. */
  moves: Map<string, TidyMove>;
  /** The grown sheet, when a finite page needs more room; undefined when it is left as it is. */
  sheet?: Sheet;
  /** What was done, in words, for the user to read before applying. */
  notes: string[];
  changed: boolean;
  /** The layout this was worked out from. Applying checks it still matches, so a page edited in the meantime is left alone. */
  basis: string;
  counts: { aligned: number; resized: number; separated: number; grew: boolean; unfit: boolean };
}

/** `fixed`: a locked box, or a frame holding one. It stays exactly where it is; everything else tidies around it. */
type Unit = { id: string; x: number; y: number; w: number; h: number; block: Block; inside: string[]; sizable: boolean; fixed: boolean };

/** The layout of the boxes as one string: ids, places and widths. */
export const layoutKey = (blocks: readonly Block[]): string => blocks.map((b) => `${b.id}:${b.x},${b.y},${b.w}`).join(';');

import { isSticky } from './note';
const SIZABLE = new Set<Block['type']>(['note', 'checklist', 'table']);

const overlaps = (a: Unit, b: Unit) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) >= MIN_OVERLAP && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) >= MIN_OVERLAP;
/** A box lying wholly on a *frame* belongs there (a note on a board); wholly inside any other box it is just covering it. */
const onFrame = (outer: Unit, inner: Unit) => outer.block.type === 'frame' && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Groups values that lie within `tol` of the first value of their group (sorted), returning the groups as lists of indexes. */
function clusters(values: readonly number[], tol: number): number[][] {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b] || a - b);
  const out: number[][] = [];
  for (const i of order) {
    const g = out[out.length - 1];
    if (g && values[i] - values[g[0]] <= tol) g.push(i);
    else out.push([i]);
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/** One pass over the units. Returns what each step changed. */
function pass(units: Unit[]) {
  const moved = new Set<string>();
  const resized = new Set<string>();
  const pushed = new Set<string>();

  // 1. Line up left edges, and tops, that are nearly the same.
  for (const axis of ['x', 'y'] as const) {
    for (const g of clusters(units.map((u) => u[axis]), ALIGN_TOLERANCE)) {
      if (g.length < 2) continue;
      // A value one of them already has; a fixed box's own value when there is one, since that box cannot move.
      const fixedIn = g.find((i) => units[i].fixed);
      const target = fixedIn !== undefined ? units[fixedIn][axis] : median(g.map((i) => units[i][axis]));
      for (const i of g) {
        if (units[i][axis] !== target && !units[i].fixed) {
          units[i][axis] = target;
          moved.add(units[i].id);
        }
      }
    }
  }

  // 2. Boxes of nearly the same width (text, lists, code, tables) get exactly the same width.
  const wide = units.filter((u) => u.sizable && !u.fixed);
  for (const g of clusters(wide.map((u) => u.w), ALIGN_TOLERANCE)) {
    if (g.length < 2) continue;
    const target = median(g.map((i) => wide[i].w));
    for (const i of g) {
      if (wide[i].w !== target) {
        wide[i].w = target;
        resized.add(wide[i].id);
      }
    }
  }

  // 3. Boxes that overlap: the one further down moves below the other. (A box lying wholly on a frame, such as a note on a board, is fine.)
  // Fixed boxes are placed first, so only the others ever move out of the way.
  const order = [...units].sort((a, b) => Number(b.fixed) - Number(a.fixed) || a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  const placed: Unit[] = [];
  for (const u of order) {
    for (let guard = 0; guard < 500; guard++) {
      const hit = placed.find((p) => overlaps(u, p) && !onFrame(p, u) && !onFrame(u, p));
      if (!hit || u.fixed) break;
      u.y = snap(hit.y + hit.h + GAP);
      pushed.add(u.id);
    }
    placed.push(u);
  }
  return { moved, resized, pushed, any: moved.size + resized.size + pushed.size > 0 };
}

/** Works out a tidier layout for the page. Never changes the page itself. */
export function tidyPage(page: Pick<Page, 'blocks' | 'sheet'>): TidyResult {
  const blocks = page.blocks;
  const ids = new Set(blocks.map((b) => b.id));
  const topLevel = blocks.filter((b) => !b.frameId || !ids.has(b.frameId));
  const lockedIds = new Set(blocks.filter((b) => b.locked).map((b) => b.id));
  const units: Unit[] = topLevel.map((b) => {
    const inside = b.type === 'frame' ? [...frameDescendants(blocks, b.id)].filter((id) => id !== b.id) : [];
    return {
      id: b.id, x: b.x, y: b.y, w: b.w, h: blockHeight(b), block: b, sizable: SIZABLE.has(b.type) && !isSticky(b),
      inside, fixed: lockedIds.has(b.id) || inside.some((id) => lockedIds.has(id)),
    };
  });
  const start = new Map(units.map((u) => [u.id, { x: u.x, y: u.y, w: u.w }]));

  // Repeat until nothing more changes, so that tidying a tidy page changes nothing (a box moved out of the way may now line up with another).
  const moved = new Set<string>(), resized = new Set<string>(), pushed = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const r = pass(units);
    r.moved.forEach((x) => moved.add(x));
    r.resized.forEach((x) => resized.add(x));
    r.pushed.forEach((x) => pushed.add(x));
    if (!r.any) break;
  }

  const moves = new Map<string, TidyMove>();
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const u of units) {
    const s = start.get(u.id)!;
    if (u.x === s.x && u.y === s.y && u.w === s.w) continue;
    moves.set(u.id, u.w !== s.w ? { x: u.x, y: u.y, w: u.w } : { x: u.x, y: u.y });
    const dx = u.x - s.x, dy = u.y - s.y;
    if (dx || dy) for (const id of u.inside) {
      const b = byId.get(id);
      if (b) moves.set(id, { x: b.x + dx, y: b.y + dy });
    }
  }

  // A finite page that no longer holds everything gets more room (nothing is squeezed).
  let sheet: Sheet | undefined;
  let unfit = false;
  if (page.sheet) {
    const rects = blocks.map((b) => {
      const m = moves.get(b.id);
      return { x: m?.x ?? b.x, y: m?.y ?? b.y, w: m?.w ?? b.w, h: blockHeight(b) };
    });
    const grown = sheetCovering(page.sheet, rects);
    if (!sameSheet(grown, page.sheet)) sheet = grown;
    unfit = rects.some((r) => r.x < grown.x || r.y < grown.y || r.x + r.w > grown.x + grown.w || r.y + r.h > grown.y + grown.h);
  }

  const aligned = [...moved].filter((id) => !pushed.has(id)).length;
  const notes: string[] = [];
  if (aligned) notes.push(`Lined up ${aligned} ${aligned === 1 ? 'box' : 'boxes'} with their neighbours.`);
  if (resized.size) notes.push(`Gave ${resized.size} ${resized.size === 1 ? 'box' : 'boxes'} the same width as the ones beside ${resized.size === 1 ? 'it' : 'them'}.`);
  if (pushed.size) notes.push(`Moved ${pushed.size} overlapping ${pushed.size === 1 ? 'box' : 'boxes'} out of the way.`);
  if (sheet) notes.push('Made the page bigger so everything fits.');
  if (unfit) notes.push('The page is too big to grow any further, so some boxes may still sit outside it.');
  return {
    moves, sheet, notes, changed: moves.size > 0 || !!sheet, basis: layoutKey(blocks),
    counts: { aligned, resized: resized.size, separated: pushed.size, grew: !!sheet, unfit },
  };
}

/** The page's boxes as they would be after the tidy (copies; the originals are untouched). Used for the "after" picture. */
export function tidied(blocks: readonly Block[], result: TidyResult): Block[] {
  return blocks.map((b) => {
    const m = result.moves.get(b.id);
    return m ? ({ ...b, x: m.x, y: m.y, ...(m.w !== undefined ? { w: m.w } : {}) } as Block) : b;
  });
}
