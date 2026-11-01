import { describe, expect, it } from 'vitest';
import { contentBounds, EDGE_PX, fitView, growOrigin, initialOrigin, scrollShift, toCanvas } from '../src/lib/viewport';

describe('infinite canvas maths', () => {
  it('bounds everything, negative positions included', () => {
    expect(contentBounds([])).toBeNull();
    expect(contentBounds([{ x: -200, y: 10, w: 100, h: 50 }, { x: 300, y: -40, w: 20, h: 20 }])).toEqual({ minX: -200, minY: -40, maxX: 320, maxY: 60 });
  });

  it('starts with room before the top-left, more when content already sits further out', () => {
    const plain = initialOrigin(null, 1);
    expect(plain.x).toBeLessThan(-EDGE_PX);
    expect(initialOrigin({ minX: 100, minY: 50, maxX: 300, maxY: 200 }, 1)).toEqual(plain);
    expect(initialOrigin({ minX: -5000, minY: 0, maxX: 0, maxY: 10 }, 1).x).toBeLessThan(-5000 - EDGE_PX);
    // zoomed out, the same screen distance covers more canvas
    expect(initialOrigin(null, 0.25).x).toBeLessThan(plain.x);
  });

  it('only grows the origin when content or the view nears the edge, and never moves it back', () => {
    const o = -2400;
    expect(growOrigin(o, 100, 2400, 1)).toBe(o); // everything well inside
    expect(growOrigin(o, null, 5000, 1)).toBe(o);
    const byContent = growOrigin(o, o + 100, 2400, 1); // a box dragged to the edge
    expect(byContent).toBeLessThan(o);
    expect(Math.abs(byContent % 256)).toBe(0);
    expect(growOrigin(o, o + 100, 2400, 1)).toBe(byContent); // stable for the same input
    expect(growOrigin(o, null, 100, 1)).toBeLessThan(o); // the view scrolled to the edge
    expect(growOrigin(o, 5000, 2400, 1)).toBe(o); // content moving inwards never shrinks it
  });

  it('shifts the scroll so the same canvas stays in view when the origin moves', () => {
    const z = 0.5;
    const scroll = 900;
    const oldO = -2000;
    const newO = -3600;
    const before = toCanvas(0, scroll, oldO, z);
    const after = toCanvas(0, scroll + scrollShift(oldO, newO, z), newO, z);
    expect(after).toBeCloseTo(before);
  });

  it('fits content into the view, centred, without zooming in past 100%', () => {
    const big = fitView({ minX: -1000, minY: -500, maxX: 3000, maxY: 1500 }, 1000, 800, 0.25);
    expect(big.zoom).toBeLessThan(1);
    const w = 4000 * big.zoom;
    expect(w).toBeLessThanOrEqual(1000);
    // content's centre lands in the middle of the viewport
    expect((1000 / 2) / big.zoom + big.x).toBeCloseTo(1000);
    const small = fitView({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 1000, 800, 0.25);
    expect(small.zoom).toBe(1);
    const huge = fitView({ minX: 0, minY: 0, maxX: 100000, maxY: 100 }, 1000, 800, 0.25);
    expect(huge.zoom).toBe(0.25);
  });
});
