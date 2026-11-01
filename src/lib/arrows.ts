/**
 * Connector routing: a straight line between the two edge midpoints of a pair
 * of boxes that are closest together, picked from the 4x4 side combinations.
 * Pure maths, no DOM/store, same shape as guides.ts.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: Side[] = ['right', 'bottom', 'left', 'top'];

export interface RoutePoint {
  x: number;
  y: number;
  side: Side;
}

export interface Route {
  from: RoutePoint;
  to: RoutePoint;
}

/** Midpoint of one side of a rect. */
export function sidePoint(r: Rect, side: Side): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: r.x + r.w / 2, y: r.y };
    case 'bottom':
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case 'left':
      return { x: r.x, y: r.y + r.h / 2 };
    case 'right':
      return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
}

/** The direction pointing out of a box through one of its sides. */
const OUT: Record<Side, { x: number; y: number }> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/**
 * The shortest side-to-side route between two rects: a straight line between
 * whichever pair of side midpoints is closest, as long as the line leaves each box
 * outwards (never back through its own box, as a line from the left edge of a wide box
 * to something below it would). If the boxes overlap so closely that no pair does,
 * every pair is considered. Ties are broken by a fixed side-preference order so the
 * result is deterministic.
 */
export function routeBetween(a: Rect, b: Rect): Route {
  for (const outwardOnly of [true, false]) {
    let best: Route | null = null;
    let bestDist = Infinity;
    for (const sideA of SIDES) {
      const pa = sidePoint(a, sideA);
      for (const sideB of SIDES) {
        const pb = sidePoint(b, sideB);
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        if (outwardOnly) {
          const oa = OUT[sideA], ob = OUT[sideB];
          if (dx * oa.x + dy * oa.y < 0 || -dx * ob.x - dy * ob.y < 0) continue;
        }
        const d = Math.hypot(dx, dy);
        if (d < bestDist - 1e-9) {
          bestDist = d;
          best = { from: { ...pa, side: sideA }, to: { ...pb, side: sideB } };
        }
      }
    }
    if (best) return best;
  }
  throw new Error('unreachable');
}
