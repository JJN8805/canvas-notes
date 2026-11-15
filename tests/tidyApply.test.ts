import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { applyTidy, createPage, undo, updateBlock, useNotes } from '../src/store/notes';
import { history } from '../src/store/history';
import { tidyPage } from '../src/lib/tidy';
import type { Block } from '../src/types';

const box = (id: string, x: number, y: number, w = 300, h = 100): Block => ({ id, type: 'note', style: 'text', x, y, w, h, z: 1, html: '<p>x</p>' }) as Block;
const blocksOf = (id: string) => useNotes.getState().pages[id].blocks;
const messy = () => [box('a', 80, 80), box('b', 90, 130), box('c', 500, 84, 310)];

describe('applying a tidy', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useNotes.setState({ filter: { kind: 'all' }, pages: {} });
  });
  afterEach(() => vi.restoreAllMocks());

  it('moves the boxes as proposed, and one undo puts every one back', async () => {
    const p = createPage({ blocks: messy() });
    history.clear(p.id);
    const before = JSON.stringify(blocksOf(p.id).map((b) => [b.id, b.x, b.y, b.w]));
    const r = tidyPage(useNotes.getState().pages[p.id]);
    expect(r.changed).toBe(true);
    expect(applyTidy(p.id, r)).toBe('applied');
    expect(JSON.stringify(blocksOf(p.id).map((b) => [b.id, b.x, b.y, b.w]))).not.toBe(before);
    expect(tidyPage(useNotes.getState().pages[p.id]).changed).toBe(false); // now tidy
    await undo(p.id);
    expect(JSON.stringify(blocksOf(p.id).map((b) => [b.id, b.x, b.y, b.w]))).toBe(before);
    expect(history.canUndo(p.id)).toBe(false); // it was a single step
  });

  it('changes nothing when the page was edited after the proposal was worked out', () => {
    const p = createPage({ blocks: messy() });
    const r = tidyPage(useNotes.getState().pages[p.id]);
    updateBlock(p.id, 'a', (b) => void (b.x = 200));
    const mid = JSON.stringify(blocksOf(p.id));
    expect(applyTidy(p.id, r)).toBe('stale');
    expect(JSON.stringify(blocksOf(p.id))).toBe(mid);
  });

  it('does nothing for a page that is already tidy, or one that is gone', () => {
    const p = createPage({ blocks: [box('a', 80, 80), box('b', 80, 280)] });
    expect(applyTidy(p.id, tidyPage(useNotes.getState().pages[p.id]))).toBe('nothing');
    expect(applyTidy('missing', tidyPage({ blocks: messy(), sheet: null }))).toBe('stale');
  });

  it('grows a finite page that no longer fits, in the same step', () => {
    const p = createPage({ blocks: Array.from({ length: 12 }, (_, i) => box('b' + i, 100, 100, 600, 300)) });
    const h = useNotes.getState().pages[p.id].sheet!.h;
    const r = tidyPage(useNotes.getState().pages[p.id]);
    expect(applyTidy(p.id, r)).toBe('applied');
    const after = useNotes.getState().pages[p.id];
    expect(after.sheet!.h).toBeGreaterThan(h);
    expect(Math.max(...after.blocks.map((b) => b.y + b.h))).toBeLessThanOrEqual(after.sheet!.y + after.sheet!.h);
  });
});
