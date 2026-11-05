import { describe, expect, it } from 'vitest';
import { cleanArrows, cleanBlock, cleanBlocks, cleanTags } from '../src/lib/sanitize';
import { normalizePage } from '../src/storage/types';

const good = [
  { id: 't', type: 'text', x: 1, y: 2, w: 100, h: 40, z: 1, html: '<p>hi</p>' },
  { id: 'c', type: 'checklist', x: 0, y: 0, w: 100, h: 40, z: 2, items: [{ id: 'i', text: 'a', done: true }] },
  { id: 'k', type: 'table', x: 0, y: 0, w: 100, h: 40, z: 3, rows: [['a', 'b'], ['c', 'd']] },
  { id: 'p', type: 'code', x: 0, y: 0, w: 100, h: 40, z: 4, code: 'x' },
];

describe('pages read from storage are repaired so the screens cannot crash on them', () => {
  it('leaves valid boxes exactly as they are (same keys, same values)', () => {
    expect(cleanBlocks(good)).toEqual(good);
    expect(JSON.stringify(cleanBlocks(good))).toBe(JSON.stringify(good));
  });
  it('drops entries that cannot be a box', () => {
    expect(cleanBlocks([null, 5, 'x', [], { id: 'n' }, good[0]])).toEqual([good[0]]);
    expect(cleanBlocks(undefined)).toEqual([]);
    expect(cleanBlocks('nope')).toEqual([]);
  });
  it('gives each type the fields it needs', () => {
    expect(cleanBlock({ type: 'text' })).toMatchObject({ html: '', x: 0, y: 0 });
    expect(cleanBlock({ type: 'checklist', items: [null, { text: 5 }, { id: 'z', text: 'ok', done: 'yes' }] })).toMatchObject({ items: [{ text: '', done: false }, { id: 'z', text: 'ok', done: false }] });
    expect(cleanBlock({ type: 'checklist' })).toMatchObject({ items: [] });
    expect(cleanBlock({ type: 'table', rows: ['a', null, [1, null]] })).toMatchObject({ rows: [['1', '']] });
    expect(cleanBlock({ type: 'table' })).toMatchObject({ rows: [['']] });
    expect(cleanBlock({ type: 'table', rows: [['a'], ['b', 'c']] })).toMatchObject({ rows: [['a', ''], ['b', 'c']] });
    expect(cleanBlock({ type: 'code' })).toMatchObject({ code: '' });
    expect(cleanBlock({ type: 'image', aspect: 0 })).toMatchObject({ imageId: '', aspect: 1 });
  });
  it('replaces bad geometry and duplicate ids', () => {
    expect(cleanBlock({ type: 'text', x: NaN, y: Infinity, w: 'wide', h: -4 })).toMatchObject({ x: 0, y: 0, w: 240, h: 1 });
    const [a, b] = cleanBlocks([{ id: 's', type: 'text' }, { id: 's', type: 'text' }]);
    expect(a.id).not.toBe(b.id);
  });
  it('keeps a box of a type it does not know (it may come from a newer version)', () => {
    expect(cleanBlock({ id: 'h', type: 'hologram', x: 1, y: 1, w: 5, h: 5, z: 1, beam: 3 })).toMatchObject({ type: 'hologram', beam: 3 });
  });
  it('drops a tracking record that is not whole, and keeps a whole one', () => {
    expect(cleanBlock({ type: 'checklist', items: [], track: { start: 'x' } })).not.toHaveProperty('track');
    const track = { start: '2026-01-01', day: '2026-01-02', log: {}, first: {} };
    expect(cleanBlock({ type: 'checklist', items: [], track })).toMatchObject({ track });
  });
  it('cleans arrows and tags', () => {
    expect(cleanArrows([null, { id: 'a', from: 'x', to: 'y' }, { from: 1 }])).toEqual([{ id: 'a', from: 'x', to: 'y' }]);
    expect(cleanArrows(undefined)).toEqual([]);
    expect(cleanTags(['a', null, 3, 'b'])).toEqual(['a', 'b']);
  });
  it('is applied whenever a page is read', () => {
    const p = normalizePage({ id: 'p', title: null as never, tags: [null] as never, blocks: [null, { type: 'table' }] as never, arrows: [5] as never });
    expect(p.title).toBe('');
    expect(p.tags).toEqual([]);
    expect(p.blocks).toHaveLength(1);
    expect(p.arrows).toEqual([]);
  });
});
