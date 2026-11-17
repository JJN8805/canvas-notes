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

import { noteLines, noteToChecklist } from '../src/lib/turnInto';
import type { Block } from '../src/types';

describe('turning a note into a list', () => {
  const note = { id: 'n', type: 'note', style: 'text', x: 10, y: 20, w: 300, h: 90, z: 3, html: '<p>Milk</p><p></p><p> Bread </p>', tint: 'blue', locked: false, links: [{ page: 'p' }] } as unknown as Block;
  it('makes one item per non-empty line', () => expect(noteLines(note as never)).toEqual(['Milk', 'Bread']));
  it('keeps the box where it is, with its id, colour and links', () => {
    const c = noteToChecklist(note)!;
    expect(c).toMatchObject({ id: 'n', type: 'checklist', x: 10, y: 20, w: 300, z: 3, tint: 'blue', links: [{ page: 'p' }] });
    expect(c.items.map((i) => i.text)).toEqual(['Milk', 'Bread']);
    expect(c.items.every((i) => !i.done && i.id)).toBe(true);
    expect(c).not.toHaveProperty('html');
  });
  it('makes one empty item from an empty note, and refuses other kinds of box', () => {
    expect(noteToChecklist({ ...note, html: '' } as never)!.items).toHaveLength(1);
    expect(noteToChecklist({ id: 't', type: 'table', rows: [] } as never)).toBeNull();
  });
});
