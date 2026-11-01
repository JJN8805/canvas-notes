import { describe, expect, it } from 'vitest';
import { routeBetween, sidePoint } from '../src/lib/arrows';

describe('connector routing', () => {
  it('picks the facing left/right sides for boxes side by side', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 300, y: 0, w: 100, h: 100 };
    const route = routeBetween(a, b);
    expect(route.from.side).toBe('right');
    expect(route.to.side).toBe('left');
    expect(route.from).toEqual({ x: 100, y: 50, side: 'right' });
    expect(route.to).toEqual({ x: 300, y: 50, side: 'left' });
  });

  it('picks the facing top/bottom sides for boxes stacked vertically', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 0, y: 300, w: 100, h: 100 };
    const route = routeBetween(a, b);
    expect(route.from.side).toBe('bottom');
    expect(route.to.side).toBe('top');
  });

  it('never routes back through its own box: below a wide box it leaves from the bottom, not the left edge', () => {
    const wide = { x: 0, y: 0, w: 900, h: 200 };
    const below = { x: 0, y: 400, w: 200, h: 200 }; // under the wide box's left end
    const route = routeBetween(wide, below);
    expect(route.from.side).toBe('bottom'); // not 'left', which would cross the wide box
    expect(['top', 'right']).toContain(route.to.side);
    const back = routeBetween(below, wide);
    expect(back.to.side).toBe('bottom');
    expect(['top', 'right']).toContain(back.from.side);
  });

  it('only leaves a box outwards, for any placement of a smaller box around a wide one', () => {
    const wide = { x: 300, y: 300, w: 800, h: 160 };
    const dir = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] } as const;
    for (const x of [0, 300, 650, 1000, 1300]) {
      for (const y of [0, 600]) {
        const r = routeBetween(wide, { x, y, w: 100, h: 100 });
        const dx = r.to.x - r.from.x, dy = r.to.y - r.from.y;
        const [ox, oy] = dir[r.from.side];
        expect(dx * ox + dy * oy, `${x},${y}`).toBeGreaterThanOrEqual(0);
        const [px, py] = dir[r.to.side];
        expect(-dx * px - dy * py, `${x},${y}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is symmetric: swapping the two boxes mirrors the route', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 300, y: 0, w: 100, h: 100 };
    const ab = routeBetween(a, b);
    const ba = routeBetween(b, a);
    expect(ba.from).toEqual(ab.to);
    expect(ba.to).toEqual(ab.from);
  });

  it('picks a diagonally-nearest pair of sides for offset boxes', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 300, y: 300, w: 100, h: 100 };
    const route = routeBetween(a, b);
    // Bottom-right-ish corner of a faces top-left-ish corner of b.
    expect(['right', 'bottom']).toContain(route.from.side);
    expect(['left', 'top']).toContain(route.to.side);
  });

  it('never throws on identical, overlapping or zero-size rects', () => {
    const z = { x: 0, y: 0, w: 0, h: 0 };
    expect(() => routeBetween(z, z)).not.toThrow();
    const route = routeBetween(z, z);
    expect(Number.isFinite(route.from.x)).toBe(true);
    expect(Number.isFinite(route.to.x)).toBe(true);
    const overlap = { x: 10, y: 10, w: 50, h: 50 };
    expect(() => routeBetween(overlap, overlap)).not.toThrow();
  });

  it('is deterministic across repeated calls with the same inputs', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 100, y: 100, w: 100, h: 100 }; // touching corner: several sides tie
    const first = routeBetween(a, b);
    for (let i = 0; i < 5; i++) expect(routeBetween(a, b)).toEqual(first);
  });

  it('gives the midpoint of each side', () => {
    const r = { x: 10, y: 20, w: 100, h: 50 };
    expect(sidePoint(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sidePoint(r, 'bottom')).toEqual({ x: 60, y: 70 });
    expect(sidePoint(r, 'left')).toEqual({ x: 10, y: 45 });
    expect(sidePoint(r, 'right')).toEqual({ x: 110, y: 45 });
  });
});
