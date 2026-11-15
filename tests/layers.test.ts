import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { markTargets, splitByDrawing, stepOrder, topLevelOf } from '../src/lib/layers';
import { paintOrder } from '../src/lib/frames';
import { cleanBlock } from '../src/lib/sanitize';
import { bringToFront, createPage, sendToBack, setDrawingBehind, setOverDrawing, setPageDrawing, stepBlocks, undo, useNotes } from '../src/store/notes';
import { history } from '../src/store/history';
import type { Block, PageDrawing } from '../src/types';

const box = (id: string, z: number, extra: Partial<Block> = {}): Block => ({ id, type: 'note', style: 'text', x: 0, y: 0, w: 100, h: 50, z, html: '<p>x</p>', ...extra }) as Block;
const frame = (id: string, z = 0): Block => ({ id, type: 'frame', x: 0, y: 0, w: 400, h: 300, z, title: '', color: 'teal', collapsed: false }) as Block;
const zs = (blocks: Block[], order: Map<string, number>) => Object.fromEntries(blocks.map((b) => [b.id, order.get(b.id) ?? b.z]));
const ink = (extra: Partial<PageDrawing> = {}): PageDrawing => ({ scene: '{}', preview: '<svg/>', x: 0, y: 0, w: 100, h: 100, ...extra });

describe('what is painted over what', () => {
  it('keeps every box under the drawing unless it is marked over, in paint order within each part', () => {
    const blocks = [box('a', 1), box('b', 2, { over: true }), box('c', 3), box('d', 4, { over: true })];
    const { below, above } = splitByDrawing(paintOrder(blocks), blocks);
    expect(below.map((b) => b.id)).toEqual(['a', 'c']);
    expect(above.map((b) => b.id)).toEqual(['b', 'd']);
  });

  it('a frame’s contents follow the frame, whatever mark they carry themselves', () => {
    const blocks = [frame('f', 1), box('in', 2, { frameId: 'f' }), box('out', 3), box('stray', 4, { frameId: 'f', over: true })];
    expect(splitByDrawing(paintOrder(blocks), blocks).above).toEqual([]); // the frame is not over, so neither is anything in it
    const over = blocks.map((b) => (b.id === 'f' ? { ...b, over: true } : b)) as Block[];
    const { below, above } = splitByDrawing(paintOrder(over), over);
    expect(above.map((b) => b.id).sort()).toEqual(['f', 'in', 'stray']);
    expect(below.map((b) => b.id)).toEqual(['out']);
  });

  it('finds the top-level box of a nested one, and survives a frame loop', () => {
    const blocks = [frame('f'), frame('g', 1, ), box('in', 2, { frameId: 'g' })];
    blocks[1] = { ...blocks[1], frameId: 'f' } as Block;
    expect(topLevelOf(blocks).get('in')).toBe('f');
    const loop = [{ ...frame('a'), frameId: 'b' }, { ...frame('b'), frameId: 'a' }, box('x', 1, { frameId: 'a' })] as Block[];
    expect(() => topLevelOf(loop)).not.toThrow();
    expect(() => splitByDrawing(paintOrder(loop), loop)).not.toThrow();
  });

  it('a mark on a nested box counts for its top-level frame, once', () => {
    const blocks = [frame('f'), box('p', 1, { frameId: 'f' }), box('q', 2, { frameId: 'f' }), box('r', 3)];
    expect(markTargets(blocks, ['p', 'q', 'r'])).toEqual(['f', 'r']);
  });

  it('only "true" is a mark: anything else on a stored box is dropped', () => {
    expect(cleanBlock({ id: 'a', type: 'note', style: 'text', html: '', over: 'yes' })).not.toHaveProperty('over');
    expect(cleanBlock({ id: 'a', type: 'note', style: 'text', html: '', over: false })).not.toHaveProperty('over');
    expect(cleanBlock({ id: 'a', type: 'note', style: 'text', html: '', over: true })).toHaveProperty('over', true);
  });
});

describe('moving a box one place', () => {
  const four = () => [box('a', 1), box('b', 2), box('c', 3), box('d', 4)];
  it('forward swaps with the box above, backward with the one below', () => {
    expect(zs(four(), stepOrder(four(), ['b'], 'forward'))).toEqual({ a: 1, b: 3, c: 2, d: 4 });
    expect(zs(four(), stepOrder(four(), ['c'], 'backward'))).toEqual({ a: 1, b: 3, c: 2, d: 4 });
  });
  it('does nothing at the end of the stack', () => {
    expect(stepOrder(four(), ['d'], 'forward').size).toBe(0);
    expect(stepOrder(four(), ['a'], 'backward').size).toBe(0);
    expect(stepOrder(four(), ['zzz'], 'forward').size).toBe(0);
  });
  it('moves a chosen group together without scrambling it', () => {
    expect(zs(four(), stepOrder(four(), ['a', 'b'], 'forward'))).toEqual({ a: 2, b: 3, c: 1, d: 4 });
    expect(zs(four(), stepOrder(four(), ['c', 'd'], 'forward')) ).toEqual({ a: 1, b: 2, c: 3, d: 4 }); // already on top
    expect(zs(four(), stepOrder(four(), ['a', 'c'], 'forward'))).toEqual({ a: 2, b: 1, c: 4, d: 3 });
  });
  it('copes with boxes that share a z, so every press changes the order', () => {
    const same = [box('a', 1), box('b', 1), box('c', 1)];
    const r = stepOrder(same, ['a'], 'forward');
    expect(r.size).toBeGreaterThan(0);
    const after = same.map((b) => ({ ...b, z: r.get(b.id) ?? b.z }));
    expect(paintOrder(after).map((b) => b.id)[0]).not.toBe('a');
  });
  it('keeps frames behind plain boxes and each frame’s contents among themselves', () => {
    const blocks = [frame('f', 1), box('p', 5), box('in1', 1, { frameId: 'f' }), box('in2', 2, { frameId: 'f' })];
    expect(stepOrder(blocks, ['f'], 'forward').size).toBe(0); // the only frame: nothing to pass (plain boxes are always in front of frames)
    const r = stepOrder(blocks, ['in1'], 'forward');
    expect(r.get('in1')).toBe(2);
    expect(r.get('in2')).toBe(1);
    expect(r.has('p')).toBe(false);
  });
});

describe('in the store', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useNotes.setState({ filter: { kind: 'all' }, pages: {} });
  });
  afterEach(() => vi.restoreAllMocks());
  const blocksOf = (id: string) => useNotes.getState().pages[id].blocks;
  const order = (id: string) => paintOrder(blocksOf(id)).map((b) => b.id).join('');

  it('forward, backward, to the front and to the back each make one undo step', async () => {
    const p = createPage({ blocks: [box('a', 1), box('b', 2), box('c', 3)] });
    history.clear(p.id);
    stepBlocks(p.id, ['a'], 'forward');
    expect(order(p.id)).toBe('bac');
    await undo(p.id);
    expect(order(p.id)).toBe('abc');
    bringToFront(p.id, ['a'], { undoable: true });
    expect(order(p.id)).toBe('bca');
    await undo(p.id);
    expect(order(p.id)).toBe('abc');
    sendToBack(p.id, ['c']);
    expect(order(p.id)).toBe('cab');
    await undo(p.id);
    expect(order(p.id)).toBe('abc');
    expect(history.canUndo(p.id)).toBe(false);
  });

  it('clicking a box still brings it to the front quietly, with no undo step', () => {
    const p = createPage({ blocks: [box('a', 1), box('b', 2)] });
    history.clear(p.id);
    bringToFront(p.id, ['a']);
    expect(order(p.id)).toBe('ba');
    expect(history.canUndo(p.id)).toBe(false);
  });

  it('marking a box over the drawing is one undo step, and nesting marks the frame', async () => {
    const p = createPage({ blocks: [box('a', 1), frame('f', 2), box('in', 3, { frameId: 'f' })] });
    history.clear(p.id);
    setOverDrawing(p.id, ['a'], true);
    expect(blocksOf(p.id).find((b) => b.id === 'a')!.over).toBe(true);
    setOverDrawing(p.id, ['in'], true);
    expect(blocksOf(p.id).find((b) => b.id === 'f')!.over).toBe(true);
    expect(blocksOf(p.id).find((b) => b.id === 'in')!.over).toBeUndefined();
    setOverDrawing(p.id, ['a'], true); // already so: no step
    await undo(p.id);
    await undo(p.id);
    expect(blocksOf(p.id).some((b) => b.over)).toBe(false);
    expect(history.canUndo(p.id)).toBe(false);
    setOverDrawing(p.id, ['a'], true);
    setOverDrawing(p.id, ['a'], false);
    expect(blocksOf(p.id).find((b) => b.id === 'a')).not.toHaveProperty('over');
  });

  it('the drawing can be put behind the boxes and back, and drawing again keeps that', () => {
    const p = createPage({ blocks: [box('a', 1)] });
    setPageDrawing(p.id, ink());
    expect(useNotes.getState().pages[p.id].drawing?.behind).toBeUndefined();
    setDrawingBehind(p.id, true);
    expect(useNotes.getState().pages[p.id].drawing?.behind).toBe(true);
    setPageDrawing(p.id, ink({ w: 250 })); // a new stroke in draw mode
    expect(useNotes.getState().pages[p.id].drawing).toMatchObject({ w: 250, behind: true });
    setDrawingBehind(p.id, false);
    expect(useNotes.getState().pages[p.id].drawing).not.toHaveProperty('behind');
    setPageDrawing(p.id, null);
    setDrawingBehind(p.id, true); // nothing drawn: nothing to do
    expect(useNotes.getState().pages[p.id].drawing).toBeNull();
  });
});
