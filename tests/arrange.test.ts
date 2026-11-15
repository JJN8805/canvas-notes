import { describe, expect, it } from 'vitest';
import { alignItems, distributeItems } from '../src/lib/arrange';

const it3 = [
  { id: 'a', x: 0, y: 0, w: 100, h: 50 },
  { id: 'b', x: 150, y: 40, w: 40, h: 20 },
  { id: 'c', x: 400, y: 100, w: 100, h: 100 },
];

describe('align', () => {
  it('lines up on the left, right and centre of the whole selection', () => {
    expect(alignItems(it3, 'left').get('c')).toEqual({ x: 0, y: undefined });
    expect(alignItems(it3, 'right').get('a')).toEqual({ x: 400, y: undefined });
    expect(alignItems(it3, 'center-x').get('b')).toEqual({ x: 230, y: undefined });
    expect(alignItems(it3, 'top').get('c')).toEqual({ x: undefined, y: 0 });
    expect(alignItems(it3, 'bottom').get('a')).toEqual({ x: undefined, y: 150 });
    expect(alignItems(it3, 'center-y').get('b')?.y).toBe(90);
  });
  it('leaves boxes that are already in place alone, and needs two boxes', () => {
    expect(alignItems(it3, 'left').has('a')).toBe(false);
    expect(alignItems(it3.slice(0, 1), 'left').size).toBe(0);
  });
});

describe('distribute', () => {
  it('makes the gaps equal and keeps the outer two', () => {
    const m = distributeItems(it3, 'x');
    expect(m.get('b')).toEqual({ x: 230 }); // gaps of (500-240)/2 = 130 → 100+130
    expect(m.has('a')).toBe(false);
    expect(m.has('c')).toBe(false);
  });
  it('needs three boxes and is stable once spread', () => {
    expect(distributeItems(it3.slice(0, 2), 'x').size).toBe(0);
    const m = distributeItems(it3, 'y');
    const spread = it3.map((i) => ({ ...i, y: m.get(i.id)?.y ?? i.y }));
    expect(distributeItems(spread, 'y').size).toBe(0);
  });
});
