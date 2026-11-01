import { describe, expect, it } from 'vitest';
import type { Block, FrameBlock } from '../src/types';
import { containingFrame, frameDescendants, hiddenBlockIds, paintOrder, ungroupedAfterDelete, validFrameTargets } from '../src/lib/frames';

function frame(id: string, opts: Partial<FrameBlock> = {}): FrameBlock {
  return { id, type: 'frame', x: 0, y: 0, w: 400, h: 300, z: 0, title: id, color: 'slate', collapsed: false, frameId: null, ...opts };
}
function box(id: string, opts: Partial<Block> = {}): Block {
  return { id, type: 'text', x: 0, y: 0, w: 100, h: 40, z: 0, html: '', frameId: null, ...opts } as Block;
}

describe('frame containment', () => {
  it('collects direct and indirect descendants of a frame', () => {
    const blocks = [frame('a'), frame('b', { frameId: 'a' }), box('c', { frameId: 'b' }), box('d')];
    expect(frameDescendants(blocks, 'a')).toEqual(new Set(['a', 'b', 'c']));
  });

  it('excludes the frame itself and its own descendants as valid drop targets', () => {
    const blocks = [frame('a'), frame('b', { frameId: 'a' }), frame('c')];
    expect(validFrameTargets(blocks, 'a').map((f) => f.id)).toEqual(['c']);
  });

  it('paints a frame before its non-frame siblings, immediately followed by its own contents', () => {
    const blocks = [box('box1', { z: 5 }), frame('f1', { z: 1 }), box('child', { frameId: 'f1', z: 0 })];
    expect(paintOrder(blocks).map((b) => b.id)).toEqual(['f1', 'child', 'box1']);
  });

  it('breaks ties between same-type siblings by z', () => {
    const blocks = [frame('f1', { z: 2 }), frame('f2', { z: 1 }), box('a', { z: 2 }), box('b', { z: 1 })];
    expect(paintOrder(blocks).map((b) => b.id)).toEqual(['f2', 'f1', 'b', 'a']);
  });

  it('cascades hidden state through nested collapsed frames', () => {
    const blocks = [frame('outer', { collapsed: true }), frame('inner', { frameId: 'outer' }), box('leaf', { frameId: 'inner' }), box('free')];
    const hidden = hiddenBlockIds(blocks);
    expect(hidden.has('outer')).toBe(false); // the frame's own title bar stays visible
    expect(hidden.has('inner')).toBe(true);
    expect(hidden.has('leaf')).toBe(true);
    expect(hidden.has('free')).toBe(false);
  });

  it('reparents children to the nearest surviving ancestor when a frame is deleted', () => {
    const blocks = [frame('grandparent'), frame('parent', { frameId: 'grandparent' }), box('child', { frameId: 'parent' })];
    const updates = ungroupedAfterDelete(blocks, new Set(['parent']));
    expect(updates.get('child')).toBe('grandparent');
  });

  it('promotes to top level when no ancestor survives the deletion', () => {
    const blocks = [frame('a'), box('child', { frameId: 'a' })];
    const updates = ungroupedAfterDelete(blocks, new Set(['a']));
    expect(updates.get('child')).toBeNull();
  });

  it('picks the innermost of overlapping frames', () => {
    const blocks = [frame('outer', { x: 0, y: 0, w: 400, h: 400 }), frame('inner', { x: 50, y: 50, w: 100, h: 100 })];
    const dest = containingFrame(blocks, { x: 60, y: 60, w: 20, h: 20 }, new Set());
    expect(dest?.id).toBe('inner');
  });

  it('excludes a dragged frame and its own descendants from containment', () => {
    const blocks = [frame('a'), frame('b', { frameId: 'a' })];
    expect(containingFrame(blocks, { x: 10, y: 10, w: 10, h: 10 }, new Set(['a', 'b']))).toBeNull();
  });
});
