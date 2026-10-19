import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dropIndex, moveItem } from '../src/lib/reorder';

describe('moveItem', () => {
  const abc = ['a', 'b', 'c', 'd'];
  it('moves an item down and up', () => {
    expect(moveItem(abc, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(abc, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('leaves the list alone for the same place or a bad position, and never changes the original', () => {
    expect(moveItem(abc, 2, 2)).toEqual(abc);
    expect(moveItem(abc, -1, 2)).toEqual(abc);
    expect(moveItem(abc, 9, 2)).toEqual(abc);
    expect(moveItem(abc, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveItem(abc, 3, -5)).toEqual(['d', 'a', 'b', 'c']);
    expect(abc).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('dropIndex', () => {
  const mids = [10, 30, 50, 70]; // four rows
  it('stays put until the pointer passes the next row’s middle', () => {
    expect(dropIndex(mids, 1, 30)).toBe(1);
    expect(dropIndex(mids, 1, 49)).toBe(1);
    expect(dropIndex(mids, 1, 51)).toBe(2);
  });
  it('goes to the top or bottom when dragged past the ends', () => {
    expect(dropIndex(mids, 2, -100)).toBe(0);
    expect(dropIndex(mids, 0, 500)).toBe(3);
  });
  it('agrees with moveItem about where the row ends up', () => {
    const rows = ['a', 'b', 'c', 'd'];
    const to = dropIndex(mids, 0, 55);
    expect(moveItem(rows, 0, to)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('grab band', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  it('sits behind a box’s own content so only the band moves it', () => {
    expect(css).toMatch(/\.grab \{[^}]*inset: -9px/);
    expect(css).toMatch(/\.block:not\(\.b-frame\) > :not\(\.grab\)[^{]*\{ position: relative; \}/);
  });
});
