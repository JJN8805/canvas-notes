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
