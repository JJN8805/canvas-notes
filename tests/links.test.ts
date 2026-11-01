import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from '../src/lib/fuzzy';
import { layoutGraph, linkGraph, outgoingLinks, outline, resolveTitle } from '../src/lib/links';
import type { Block, Page } from '../src/types';

const base = { x: 0, y: 0, w: 100, h: 100, z: 1 };
const text = (id: string, html: string, o: Partial<Block> = {}): Block => ({ id, type: 'text', html, ...base, ...o }) as Block;
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
    expect(g.edges).toEqual([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]);
    expect(g.nodes.find((n) => n.id === 'a')!.links).toBe(2);
    expect(g.nodes.find((n) => n.id === 'c')).toEqual({ id: 'c', title: 'Untitled', links: 0 });
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
