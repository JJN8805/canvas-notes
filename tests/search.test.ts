import { describe, expect, it } from 'vitest';
import { parseQuery, searchPages } from '../src/lib/search';
import type { Block, Group, Page } from '../src/types';

const D = (s: string) => new Date(`${s}T12:00:00`).getTime();
const text = (html: string): Block => ({ id: 't' + html, type: 'text', x: 0, y: 0, w: 1, h: 1, z: 1, html }) as Block;
const image = (): Block => ({ id: 'i', type: 'image', x: 0, y: 0, w: 1, h: 1, z: 1, imageId: 'x', aspect: 1 }) as Block;
const page = (id: string, title: string, extra: Partial<Page> = {}): Page => ({
  id, title, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: D('2026-03-10'), rev: 0, ...extra,
});
const group = (id: string, name: string, parentId: string | null = null): Group => ({ id, name, color: 'slate', parentId });

const groups = [group('w', 'Work'), group('ml', 'ML projects', 'w'), group('h', 'Home')];
const pages = [
  page('a', 'Roadmap', { tags: ['plan'], groupId: 'w', blocks: [text('<p>ship the beta</p>'), image()], updated: D('2026-01-05') }),
  page('b', 'Training run', { tags: ['plan', 'ml'], groupId: 'ml', blocks: [text('<p>beta results</p>')], updated: D('2026-03-10') }),
  page('c', 'Groceries', { groupId: 'h', blocks: [text('<p>milk</p>')], updated: D('2026-03-20') }),
  page('d', 'Loose note', { drawing: { scene: '', preview: '', x: 0, y: 0, w: 1, h: 1 }, updated: D('2025-12-31') }),
];
const all = pages.map((p) => p.id);
const ids = (q: string) => searchPages(pages, q, groups).map((p) => p.id);

describe('library search', () => {
  it('needs every word, in any order, in the title, tags or text', () => {
    expect(ids('beta')).toEqual(['a', 'b']);
    expect(ids('results beta')).toEqual(['b']);
    expect(ids('training ml')).toEqual(['b']);
    expect(ids('zzz')).toEqual([]);
    expect(ids('  ')).toEqual(all);
  });

  it('keeps "quoted words" together', () => {
    expect(ids('"ship the"')).toEqual(['a']);
    expect(ids('"the ship"')).toEqual([]);
  });

  it('filters by tag, exactly, with # or tag:', () => {
    expect(ids('#plan')).toEqual(['a', 'b']);
    expect(ids('tag:ML')).toEqual(['b']);
    expect(ids('#plan #ml')).toEqual(['b']);
    expect(ids('#pla')).toEqual([]);
    expect(ids('#plan beta results')).toEqual(['b']);
  });

  it('filters by the kind of box, or a drawing', () => {
    expect(ids('has:image')).toEqual(['a']);
    expect(ids('has:drawing')).toEqual(['d']);
    expect(ids('has:text has:image')).toEqual(['a']);
    expect(ids('has:video')).toEqual(all); // not a kind: ignored, not "match nothing"
  });

  it('filters by group name, including subgroups', () => {
    expect(ids('in:work')).toEqual(['a', 'b']);
    expect(ids('in:ml')).toEqual(['b']);
    expect(ids('in:"ML projects"')).toEqual(['b']);
    expect(ids('in:nowhere')).toEqual([]);
  });

  it('filters by the day last edited, both ends included', () => {
    expect(ids('after:2026-03-10')).toEqual(['b', 'c']);
    expect(ids('before:2026-03-10')).toEqual(['a', 'b', 'd']);
    expect(ids('after:2026-01-01 before:2026-01-31')).toEqual(['a']);
    expect(ids('after:not-a-date')).toEqual(all);
    expect(ids('after:2026-02-30 before:2026-02-30')).toEqual(all); // right shape, no such day
  });

  it('parses what it was given', () => {
    expect(parseQuery('Beta #Plan has:image in:Work')).toMatchObject({ words: ['beta'], tags: ['plan'], has: ['image'], groups: ['work'] });
  });
});
