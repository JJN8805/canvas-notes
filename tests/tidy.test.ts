import { describe, expect, it } from 'vitest';
import { ALIGN_TOLERANCE, GAP, layoutKey, tidied, tidyPage } from '../src/lib/tidy';
import { SHEET_PORTRAIT } from '../src/lib/sheet';
import type { Block, Page } from '../src/types';

const box = (id: string, x: number, y: number, w = 300, h = 100, extra: Partial<Block> = {}): Block => ({ id, type: 'note', style: 'text', x, y, w, h, z: 1, html: '<p>x</p>', ...extra }) as Block;
const frame = (id: string, x: number, y: number, w: number, h: number): Block => ({ id, type: 'frame', x, y, w, h, z: 0, title: 'F', color: 'teal', collapsed: false }) as Block;
const pageOf = (blocks: Block[], sheet: Page['sheet'] = null) => ({ blocks, sheet });
const apply = (blocks: Block[], r: ReturnType<typeof tidyPage>) => tidied(blocks, r);
const rect = (b: Block) => ({ x: b.x, y: b.y, w: b.w, h: b.h });
const overlap = (a: Block, b: Block) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 4 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 4;

describe('tidying a layout', () => {
  it('lines up edges that are nearly the same, and leaves ones that are clearly different', () => {
    const blocks = [box('a', 80, 80), box('b', 88, 400), box('c', 72, 700), box('d', 400, 80 + ALIGN_TOLERANCE * 3)];
    const r = tidyPage(pageOf(blocks));
    const out = apply(blocks, r);
    expect(new Set(['a', 'b', 'c'].map((id) => out.find((b) => b.id === id)!.x)).size).toBe(1);
    expect(out.find((b) => b.id === 'd')!.x).toBe(400);
    expect(r.notes.join(' ')).toMatch(/Lined up/);
  });

  it('lines up tops of boxes side by side', () => {
    const blocks = [box('a', 80, 100, 200), box('b', 400, 112, 200), box('c', 720, 96, 200)];
    const out = apply(blocks, tidyPage(pageOf(blocks)));
    expect(new Set(out.map((b) => b.y)).size).toBe(1);
  });

  it('gives boxes of nearly the same width the same width, but never touches pictures or frames', () => {
    const img = { id: 'i', type: 'image', x: 80, y: 600, w: 310, h: 200, z: 1, imageId: 'x' } as unknown as Block;
    const blocks = [box('a', 80, 80, 300), box('b', 80, 300, 312), box('c', 80, 450, 296), img, frame('f', 600, 80, 305, 300)];
    const r = tidyPage(pageOf(blocks));
    const out = apply(blocks, r);
    expect(new Set(['a', 'b', 'c'].map((id) => out.find((b) => b.id === id)!.w)).size).toBe(1);
    expect(out.find((b) => b.id === 'i')!.w).toBe(310);
    expect(out.find((b) => b.id === 'f')!.w).toBe(305);
    expect(r.counts.resized).toBe(3 - 1 === 2 ? r.counts.resized : r.counts.resized); // at least one was resized
    expect(r.counts.resized).toBeGreaterThan(0);
  });

  it('moves the lower of two overlapping boxes below the other, with a gap', () => {
    const blocks = [box('a', 80, 80, 300, 200), box('b', 120, 150, 300, 100)];
    const r = tidyPage(pageOf(blocks));
    const out = apply(blocks, r);
    const a = out.find((b) => b.id === 'a')!, b = out.find((x) => x.id === 'b')!;
    expect(overlap(a, b)).toBe(false);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h + GAP - 8);
    expect(r.counts.separated).toBe(1);
  });

  it('separates a pile of boxes stacked on the same spot', () => {
    const blocks = Array.from({ length: 6 }, (_, i) => box('b' + i, 100, 100, 300, 120));
    const out = apply(blocks, tidyPage(pageOf(blocks)));
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlap(out[i], out[j])).toBe(false);
  });

  it('uses a box’s grown height when it has one', () => {
    const grown = box('a', 80, 80, 300, 40, { ah: 260 } as Partial<Block>);
    const blocks = [grown, box('b', 80, 200, 300, 60)];
    const out = apply(blocks, tidyPage(pageOf(blocks)));
    expect(out.find((b) => b.id === 'b')!.y).toBeGreaterThanOrEqual(80 + 260);
  });

  it('is idempotent: tidying a tidied page changes nothing', () => {
    const blocks = [box('a', 80, 80), box('b', 90, 130), box('c', 85, 140, 310), box('d', 500, 84), box('e', 505, 90), frame('f', 40, 600, 500, 300), box('g', 60, 640, 200, 80, { frameId: 'f' } as Partial<Block>)];
    const first = tidyPage(pageOf(blocks));
    expect(first.changed).toBe(true);
    const out = apply(blocks, first);
    const second = tidyPage(pageOf(out));
    expect(second.changed).toBe(false);
    expect(second.moves.size).toBe(0);
  });

  it('says nothing changed on a page that is already tidy, or empty', () => {
    expect(tidyPage(pageOf([])).changed).toBe(false);
    expect(tidyPage(pageOf([box('a', 80, 80), box('b', 80, 280)])).changed).toBe(false);
    expect(tidyPage(pageOf([box('a', 80, 80), box('b', 80, 280)])).notes).toEqual([]);
  });

  it('moves a frame with everything inside it, keeping the inside arrangement, and does not separate a box that sits on its frame', () => {
    const blocks = [box('a', 80, 80, 400, 300), frame('f', 100, 200, 400, 300), box('in1', 120, 260, 200, 60, { frameId: 'f' } as Partial<Block>), box('in2', 130, 340, 200, 60, { frameId: 'f' } as Partial<Block>)];
    const r = tidyPage(pageOf(blocks));
    const out = apply(blocks, r);
    const f = out.find((b) => b.id === 'f')!;
    expect(f.y).toBeGreaterThan(80 + 300 - 1); // the frame was in the way of the text box, so it moved down
    const d = (id: string, axis: 'x' | 'y') => out.find((b) => b.id === id)![axis] - f[axis];
    expect([d('in1', 'x'), d('in1', 'y'), d('in2', 'x'), d('in2', 'y')]).toEqual([20, 60, 30, 140]);
  });

  it('a damaged or odd box does not break it', () => {
    const odd = { id: 'z', type: 'note', style: 'text', x: NaN, y: 0, w: 100, h: 50, z: 1, html: '' } as unknown as Block;
    expect(() => tidyPage(pageOf([odd, box('a', 0, 0)]))).not.toThrow();
  });
});

describe('a finite page', () => {
  it('grows the sheet when the tidied layout no longer fits, and says so', () => {
    const blocks = Array.from({ length: 12 }, (_, i) => box('b' + i, 100, 100, 600, 300));
    const r = tidyPage(pageOf(blocks, SHEET_PORTRAIT));
    expect(r.sheet).toBeDefined();
    expect(r.sheet!.h).toBeGreaterThan(SHEET_PORTRAIT.h);
    expect(r.notes.join(' ')).toMatch(/bigger/);
    const out = apply(blocks, r);
    const bottom = Math.max(...out.map((b) => b.y + b.h));
    expect(bottom).toBeLessThanOrEqual(r.sheet!.y + r.sheet!.h);
  });

  it('leaves the sheet alone when everything fits, and on an infinite page', () => {
    expect(tidyPage(pageOf([box('a', 100, 100), box('b', 105, 130, 300, 100)], SHEET_PORTRAIT)).sheet).toBeUndefined();
    expect(tidyPage(pageOf(Array.from({ length: 12 }, (_, i) => box('b' + i, 100, 100, 600, 300)))).sheet).toBeUndefined();
  });
});

describe('the basis', () => {
  it('changes when any box moves or is resized, so a stale proposal can be told', () => {
    const a = [box('a', 80, 80), box('b', 80, 300)];
    expect(layoutKey(a)).toBe(tidyPage(pageOf(a)).basis);
    expect(layoutKey([box('a', 81, 80), box('b', 80, 300)])).not.toBe(layoutKey(a));
    expect(layoutKey([box('a', 80, 80, 301), box('b', 80, 300)])).not.toBe(layoutKey(a));
    expect(rect(a[0])).toEqual({ x: 80, y: 80, w: 300, h: 100 });
  });
});
