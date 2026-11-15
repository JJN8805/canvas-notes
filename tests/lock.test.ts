import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { allLocked, freeIds } from '../src/lib/lock';
import { cleanBlock } from '../src/lib/sanitize';
import { arrangeBlocks, createPage, deleteBlocks, duplicateBlocks, duplicateBlocksMap, setLocked, undo, useNotes } from '../src/store/notes';
import { history } from '../src/store/history';
import type { Block } from '../src/types';

const box = (id: string, x: number, extra: Partial<Block> = {}): Block => ({ id, type: 'note', style: 'text', x, y: 0, w: 100, h: 50, z: 1, html: '<p>x</p>', ...extra }) as Block;

describe('locked boxes', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    useNotes.setState({ filter: { kind: 'all' }, pages: {} });
  });
  afterEach(() => vi.restoreAllMocks());
  const blocksOf = (id: string) => useNotes.getState().pages[id].blocks;

  it('freeIds drops locked and unknown boxes', () => {
    const b = [box('a', 0), box('b', 0, { locked: true })];
    expect(freeIds(b, ['a', 'b', 'zzz'])).toEqual(['a']);
    expect(allLocked(b, ['b'])).toBe(true);
    expect(allLocked(b, ['a', 'b'])).toBe(false);
  });

  it('delete keeps locked boxes and says how many went', () => {
    const p = createPage({ blocks: [box('a', 0), box('b', 200, { locked: true })] });
    expect(deleteBlocks(p.id, ['a', 'b'])).toBe(1);
    expect(blocksOf(p.id).map((b) => b.id)).toEqual(['b']);
    expect(deleteBlocks(p.id, ['b'])).toBe(0);
  });

  it('align and spread leave locked boxes where they are', () => {
    const p = createPage({ blocks: [box('a', 0), box('b', 300, { locked: true }), box('c', 500)] });
    arrangeBlocks(p.id, ['a', 'b', 'c'], 'right');
    const x = Object.fromEntries(blocksOf(p.id).map((b) => [b.id, b.x]));
    expect(x.b).toBe(300);
    expect(x.a).toBe(500); // lined up with c's right edge (600), ignoring the locked b
  });

  it('lock and unlock are one undo step each, and copies are never locked', () => {
    const p = createPage({ blocks: [box('a', 0)] });
    history.clear(p.id);
    setLocked(p.id, ['a'], true);
    expect(blocksOf(p.id)[0].locked).toBe(true);
    const copy = duplicateBlocks(p.id, ['a']);
    expect(blocksOf(p.id).find((b) => b.id === copy[0])?.locked).toBeUndefined();
    expect(duplicateBlocksMap(p.id, ['a'], { history: 'none' }).size).toBe(1);
    undo(p.id);
    undo(p.id);
    undo(p.id);
    expect(blocksOf(p.id)[0].locked).toBeUndefined();
  });

  it('survives repair on read, only as true', () => {
    expect(cleanBlock(box('a', 0, { locked: true }))?.locked).toBe(true);
    expect('locked' in (cleanBlock({ ...box('a', 0), locked: 'yes' }) ?? {})).toBe(false);
  });
});
