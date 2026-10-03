/**
 * Smart guides: while a box moves (or is resized), its edges and centre snap
 * to the edges and centres of the other boxes, and a line shows the match.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Guide {
  axis: 'x' | 'y';
  /** x of a vertical line, or y of a horizontal one */
  pos: number;
  from: number;
  to: number;
}

export type Edge = 'start' | 'center' | 'end';
const ALL: Edge[] = ['start', 'center', 'end'];

const xAt = (r: Rect, e: Edge) => (e === 'start' ? r.x : e === 'center' ? r.x + r.w / 2 : r.x + r.w);
const yAt = (r: Rect, e: Edge) => (e === 'start' ? r.y : e === 'center' ? r.y + r.h / 2 : r.y + r.h);

/**
 * The smallest shift (within `threshold`) that lines one of `mine` edges up
 * with an edge or centre of another box. `null` = nothing close enough.
 */
export function nearestShift(
  rect: Rect,
  others: Rect[],
  threshold: number,
  axis: 'x' | 'y',
  mine: Edge[] = ALL,
): number | null {
  const at = axis === 'x' ? xAt : yAt;
  let best: number | null = null;
  for (const o of others) {
    for (const theirs of ALL) {
      const target = at(o, theirs);
      for (const m of mine) {
        const d = target - at(rect, m);
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best) - 1e-6)) best = d;
      }
    }
  }
  return best;
}

/** Lines for every edge of `rect` that exactly matches another box's edge or centre. */
export function guideLines(rect: Rect, others: Rect[], mineX: Edge[] = ALL, mineY: Edge[] = ALL): Guide[] {
  const out: Guide[] = [];
  const seen = new Set<string>();
  for (const axis of ['x', 'y'] as const) {
    const at = axis === 'x' ? xAt : yAt;
    for (const m of axis === 'x' ? mineX : mineY) {
      const pos = at(rect, m);
      const matches = others.filter((o) => ALL.some((e) => Math.abs(at(o, e) - pos) < 0.5));
      if (!matches.length) continue;
      const key = `${axis}:${Math.round(pos * 2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The line spans from the furthest matching box to the moving one.
      const span = [rect, ...matches];
      const from = Math.min(...span.map((r) => (axis === 'x' ? r.y : r.x)));
      const to = Math.max(...span.map((r) => (axis === 'x' ? r.y + r.h : r.x + r.w)));
      out.push({ axis, pos, from, to });
    }
  }
  return out;
}

export function boundsOf(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
}
