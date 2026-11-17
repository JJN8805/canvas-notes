import { describe, expect, it } from 'vitest';
import { SLASH_ITEMS, filterSlash } from '../src/lib/slashItems';

describe('the "/" insert menu filter', () => {
  it('lists everything when nothing is typed', () => expect(filterSlash('')).toEqual(SLASH_ITEMS));
  it('puts names that start with the text first', () => {
    expect(filterSlash('t').map((i) => i.type)[0]).toBe('text');
    expect(filterSlash('ta')[0].type).toBe('table');
  });
  it('finds a box by another name people use', () => {
    expect(filterSlash('todo')[0].type).toBe('checklist');
    expect(filterSlash('post-it')[0].type).toBe('sticky');
    expect(filterSlash('json')[0].type).toBe('code');
  });
  it('ignores case and spaces around the text, and finds nothing for nonsense', () => {
    expect(filterSlash('  CODE ')[0].type).toBe('code');
    expect(filterSlash('zzzz')).toEqual([]);
  });
  it('offers every box type once', () => expect(new Set(SLASH_ITEMS.map((i) => i.type)).size).toBe(SLASH_ITEMS.length));
});
