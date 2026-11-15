import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from '../src/lib/fuzzy';
import { backlinksOf, layoutGraph, linkGraph, outgoingLinks, outline, resolveTitle } from '../src/lib/links';
import type { Block, Page } from '../src/types';

const base = { x: 0, y: 0, w: 100, h: 100, z: 1 };
const text = (id: string, html: string, o: Partial<Block> = {}): Block => ({ id, type: 'note', style: 'text', html, ...base, ...o }) as Block;
const page = (id: string, title: string, blocks: Block[] = [], o: Partial<Page> = {}): Page => ({
  id, title, groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 1, ...o,
});
const pages = (...ps: Page[]) => Object.fromEntries(ps.map((p) => [p.id, p]));

describe('fuzzy', () => {
  it('needs the letters in order', () => {
    expect(fuzzyScore('abc', 'a big cat')).toBeGreaterThan(0);
    expect(fuzzyScore('cba', 'abc')).toBe(-1);
    expect(fuzzyScore('', 'anything')).toBe(0);
  });
  it('ranks prefix and consecutive matches first', () => {
    const r = fuzzyFilter(['Weekly review', 'Review of the week', 'New view'], 'rev', (s) => s);
    expect(r[0]).toBe('Review of the week');
    expect(r).toEqual(['Review of the week', 'Weekly review']);
  });
  it('keeps the original order for an empty query', () => {
    expect(fuzzyFilter(['b', 'a'], ' ', (s) => s)).toEqual(['b', 'a']);
  });
});

describe('links', () => {
  it('resolves a title to the oldest page, ignoring case and trash/templates', () => {
    const ps = pages(page('a', 'Alpha', [], { created: 5 }), page('b', 'alpha', [], { created: 2 }), page('t', 'Beta', [], { kind: 'template' }));
    expect(resolveTitle('ALPHA', ps)?.id).toBe('b');
    expect(resolveTitle('Beta', ps)).toBeNull();
  });
  it('lists outgoing links including broken ones', () => {
    const a = page('a', 'A', [text('1', '<p>[[B]] and [[Nope]]</p>')]);
    const ps = pages(a, page('b', 'B'));
    const out = outgoingLinks(a, ps);
    expect(out.map((o) => [o.title, o.page?.id ?? null])).toEqual([['B', 'b'], ['Nope', null]]);
  });
  it('builds an outline in reading order', () => {
    const p = page('p', 'P', [
      text('b', '<h2>Second</h2><p>x</p>', { y: 300 }),
      text('a', '<h1>First <b>one</b></h1><h3></h3>', { y: 10 }),
      { id: 'f', type: 'frame', title: 'Frame A', color: 'teal', collapsed: false, ...base, y: 150 } as Block,
    ]);
    expect(outline(p).map((o) => [o.level, o.text, o.kind])).toEqual([[1, 'First one', 'heading'], [1, 'Frame A', 'frame'], [2, 'Second', 'heading']]);
  });
  it('builds the link graph without self-links or repeats', () => {
    const ps = pages(
      page('a', 'A', [text('1', '[[B]] [[b]] [[A]] [[Gone]]')]),
      page('b', 'B', [text('1', '[[A]]')]),
      page('c', '', []),
    );
    const g = linkGraph(ps);
    expect(g.edges).toEqual([{ from: 'a', to: 'b', kind: 'text' }, { from: 'b', to: 'a', kind: 'text' }]);
    expect(g.nodes.find((n) => n.id === 'a')!.links).toBe(2);
    expect(g.nodes.find((n) => n.id === 'c')).toEqual({ id: 'c', title: 'Untitled', links: 0, kind: 'page' });
  });
  it('lays out every node inside the box, deterministically', () => {
    const ps = pages(page('a', 'A', [text('1', '[[B]]')]), page('b', 'B'), page('c', 'C'));
    const g = linkGraph(ps);
    const l1 = layoutGraph(g, 400, 300);
    const l2 = layoutGraph(g, 400, 300);
    expect([...l1]).toEqual([...l2]);
    for (const p of l1.values()) {
      expect(p.x).toBeGreaterThanOrEqual(24);
      expect(p.x).toBeLessThanOrEqual(376);
      expect(p.y).toBeGreaterThanOrEqual(24);
      expect(p.y).toBeLessThanOrEqual(276);
    }
  });
});

describe('pages that link here', () => {
  const link = (t: string) => text('l', `<p>see [[${t}]] for more</p>`);
  it('lists the pages that mention this one by its title, by name', () => {
    const ps = pages(page('a', 'Alpha'), page('b', 'Beta', [link('Alpha')]), page('c', 'Gamma', [link('alpha')]), page('d', 'Delta', [link('Beta')]));
    expect(backlinksOf('a', ps)).toEqual([{ pageId: 'b', title: 'Beta' }, { pageId: 'c', title: 'Gamma' }]);
    expect(backlinksOf('b', ps)).toEqual([{ pageId: 'd', title: 'Delta' }]);
    expect(backlinksOf('d', ps)).toEqual([]);
  });
  it('counts a page once however often it links, and never itself', () => {
    const twice = page('b', 'Beta', [link('Alpha'), text('m', '<p>[[Alpha]] again, and [[Beta]]</p>')]);
    expect(backlinksOf('a', pages(page('a', 'Alpha'), twice))).toEqual([{ pageId: 'b', title: 'Beta' }]);
    expect(backlinksOf('b', pages(page('a', 'Alpha'), twice))).toEqual([]);
  });
  it('follows a title to the oldest page that has it, like the links themselves do', () => {
    const ps = pages(page('old', 'Same', [], { created: 1 }), page('new', 'Same', [], { created: 9 }), page('x', 'X', [link('Same')]));
    expect(backlinksOf('old', ps).map((l) => l.pageId)).toEqual(['x']);
    expect(backlinksOf('new', ps)).toEqual([]);
  });
  it('ignores templates and cards, on either end', () => {
    const ps = pages(page('a', 'Alpha'), page('t', 'Tpl', [link('Alpha')], { kind: 'template' }), page('c', 'Card', [link('Alpha')], { kind: 'card' }));
    expect(backlinksOf('a', ps)).toEqual([]);
    expect(backlinksOf('t', ps)).toEqual([]); // a template has no backlinks of its own
  });
  it('is current the moment a page changes, with no second copy to catch up', () => {
    const before = pages(page('a', 'Alpha'), page('b', 'Beta', [text('l', '<p>nothing</p>')]));
    expect(backlinksOf('a', before)).toEqual([]);
    const after = { ...before, b: { ...before.b, blocks: [link('Alpha')] } };
    expect(backlinksOf('a', after)).toEqual([{ pageId: 'b', title: 'Beta' }]);
    const renamed = { ...after, a: { ...after.a, title: 'Renamed' } };
    expect(backlinksOf('a', renamed)).toEqual([]); // the link no longer points at it
  });
  it('gives an empty answer for a page that is not there', () => {
    expect(backlinksOf('nope', pages(page('a', 'Alpha')))).toEqual([]);
  });
});
