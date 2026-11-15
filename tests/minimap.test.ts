import { describe, expect, it } from 'vitest';
import { mapToCanvas, minimapLayout, worthShowing } from '../src/lib/minimap';

const view = { x: 0, y: 0, w: 1000, h: 600 };

describe('minimap', () => {
  it('has nothing to show for an empty page', () => {
    expect(minimapLayout([], view)).toBeNull();
  });
  it('fits boxes and view inside the map size and keeps proportions', () => {
    const l = minimapLayout([{ x: 0, y: 0, w: 200, h: 100 }, { x: 3000, y: 2000, w: 200, h: 100 }], view, 168, 112)!;
    expect(l.width).toBeLessThanOrEqual(168.01);
    expect(l.height).toBeLessThanOrEqual(112.01);
    expect(l.boxes).toHaveLength(2);
    expect(l.view.w / l.view.h).toBeCloseTo(1000 / 600, 1);
  });
  it('maps a click back to the canvas point it shows', () => {
    const l = minimapLayout([{ x: -500, y: -500, w: 100, h: 100 }, { x: 2000, y: 1500, w: 100, h: 100 }], view)!;
    const p = mapToCanvas(l, l.boxes[1].x, l.boxes[1].y);
    expect(p.x).toBeCloseTo(2000, 3);
    expect(p.y).toBeCloseTo(1500, 3);
  });
  it('is only worth showing when something is out of view', () => {
    expect(worthShowing([{ x: 10, y: 10, w: 100, h: 100 }], view)).toBe(false);
    expect(worthShowing([{ x: 10, y: 10, w: 100, h: 100 }, { x: 1200, y: 0, w: 10, h: 10 }], view)).toBe(true);
  });
});
