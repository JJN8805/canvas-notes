import { describe, expect, it } from 'vitest';
import { addLink, boxEdges, boxLabel, cleanLinks, incomingLinks, linkTargets, removeLink, resolveLink } from '../src/lib/boxLinks';
import { backlinksOf, linkGraph, neighbourhood } from '../src/lib/links';
import { normalizePage } from '../src/storage/types';
import type { Block, Page } from '../src/types';

const base = { x: 0, y: 0, w: 100, h: 100, z: 1 };
const text = (id: string, html: string, o: Partial<Block> = {}): Block => ({ id, type: 'note', style: 'text', html, ...base, ...o }) as Block;
const page = (id: string, title: string, blocks: Block[] = [], o: Partial<Page> = {}): Page => ({
  id, title, groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 1, ...o,
});
const pages = (...ps: Page[]) => Object.fromEntries(ps.map((p) => [p.id, p]));

describe('box links', () => {
  it('adds without repeats and removes', () => {
    let l = addLink([], { page: 'a' });
    l = addLink(l, { page: 'a' });
    l = addLink(l, { page: 'a', block: 'x' });
    expect(l).toEqual([{ page: 'a' }, { page: 'a', block: 'x' }]);
    expect(removeLink(l, { page: 'a' })).toEqual([{ page: 'a', block: 'x' }]);
  });
  it('repairs stored links', () => {
    expect(cleanLinks('no')).toEqual([]);
    expect(cleanLinks([null, 3, { page: 4 }, { page: '../x' }, { page: 'ok', block: '<bad>' }, { page: 'ok' }, { page: 'ok', block: 'b1' }])).toEqual([{ page: 'ok' }, { page: 'ok', block: 'b1' }]);
  });
  it('is kept (cleaned) when a page is read', () => {
    const p = normalizePage(page('p', 'P', [text('1', '', { links: [{ page: 'q', block: 'z' }, { page: '!!' }] as never })]));
    expect(p.blocks[0].links).toEqual([{ page: 'q', block: 'z' }]);
    const q = normalizePage(page('p', 'P', [text('1', '', { links: [] })]));
    expect('links' in q.blocks[0]).toBe(false);
  });
  it('resolves, and says what is missing', () => {
    const ps = pages(page('a', 'A', [text('1', 'Hello world')]), page('c', 'Card', [], { kind: 'card' }));
    expect(resolveLink({ page: 'a', block: '1' }, ps)).toMatchObject({ broken: null, label: 'A › Text: Hello world' });
    expect(resolveLink({ page: 'a', block: 'nope' }, ps).broken).toBe('block');
    expect(resolveLink({ page: 'gone' }, ps).broken).toBe('page');
    expect(resolveLink({ page: 'c' }, ps).label).toBe('Card');
  });
  it('labels boxes', () => {
    expect(boxLabel({ id: 'f', type: 'frame', title: 'Plan', color: 'teal', collapsed: false, ...base } as Block)).toBe('Frame: Plan');
    expect(boxLabel(text('1', ''))).toBe('Text (empty)');
  });
  it('lists edges between pages and cards, dropping broken, self and template ones', () => {
    const ps = pages(
      page('a', 'A', [text('1', '', { links: [{ page: 'b', block: '9' }, { page: 'a' }, { page: 'gone' }, { page: 't' }, { page: 'k' }] })]),
      page('b', 'B', [text('9', 'x')]),
      page('t', 'T', [], { kind: 'template' }),
      page('k', 'K', [], { kind: 'card' }),
    );
    expect(boxEdges(ps)).toEqual([
      { from: 'a', to: 'b', fromBlock: '1', toBlock: '9' },
      { from: 'a', to: 'k', fromBlock: '1', toBlock: null },
    ]);
  });
  it('finds what leads to a page or to one box', () => {
    const ps = pages(
      page('a', 'A', [text('1', '', { links: [{ page: 'b', block: '9' }] })]),
      page('c', 'C', [text('2', '', { links: [{ page: 'b' }] })]),
      page('b', 'B', [text('9', 'x')]),
    );
    expect(incomingLinks('b', ps).map((x) => x.page.id)).toEqual(['a', 'c']);
    expect(incomingLinks('b', ps, '9').map((x) => x.page.id)).toEqual(['a']);
  });
  it('shows in backlinks, including those of a card, once per page', () => {
    const ps = pages(
      page('a', 'A', [text('1', '[[B]]', { links: [{ page: 'b' }] })]),
      page('k', 'Kay', [text('2', '', { links: [{ page: 'b' }, { page: 'c' }] })], { kind: 'card' }),
      page('b', 'B'),
      page('c', 'C', [], { kind: 'card' }),
    );
    expect(backlinksOf('b', ps)).toEqual([{ pageId: 'a', title: 'A' }, { pageId: 'k', title: 'Kay' }]);
    expect(backlinksOf('c', ps)).toEqual([{ pageId: 'k', title: 'Kay' }]);
  });
  it('offers pages and cards but not templates, filtered by name', () => {
    const ps = pages(page('a', 'Apple'), page('b', 'Banana', [], { kind: 'card', updated: 5 }), page('t', 'Apple tpl', [], { kind: 'template' }));
    expect(linkTargets(ps).map((p) => p.id)).toEqual(['b', 'a']);
    expect(linkTargets(ps, 'app').map((p) => p.id)).toEqual(['a']);
  });
});

describe('graph with box links and cards', () => {
  const ps = pages(
    page('a', 'A', [text('1', '[[B]]', { links: [{ page: 'k' }, { page: 'b' }] })]),
    page('b', 'B'),
    page('k', 'Kay', [], { kind: 'card' }),
    page('z', 'Z'),
  );
  it('leaves cards out by default and marks a doubled pair as a box link', () => {
    const g = linkGraph(ps);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'z']);
    expect(g.edges).toMatchObject([{ from: 'a', to: 'b', kind: 'box' }]);
  });
  it('includes cards when asked and counts links', () => {
    const g = linkGraph(ps, { cards: true });
    expect(g.nodes.find((n) => n.id === 'k')).toEqual({ id: 'k', title: 'Kay', links: 1, kind: 'card' });
    expect(g.edges).toHaveLength(2);
  });
  it('can show only one kind of link', () => {
    expect(linkGraph(ps, { boxes: false }).edges).toEqual([{ from: 'a', to: 'b', kind: 'text' }]);
    expect(linkGraph(ps, { text: false }).edges).toMatchObject([{ from: 'a', to: 'b', kind: 'box' }]);
  });
  it('cuts out the neighbourhood of one page', () => {
    const g = linkGraph(ps, { cards: true });
    expect(neighbourhood(g, 'k').nodes.map((n) => n.id).sort()).toEqual(['a', 'k']);
    expect(neighbourhood(g, 'k', 2).nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'k']);
    expect(neighbourhood(g, 'nope').nodes).toEqual([]);
  });
});

describe('pointing a link somewhere else', () => {
  it('replaces in place, without repeats, and leaves things alone when nothing matches', async () => {
    const { replaceLink } = await import('../src/lib/boxLinks');
    const l = [{ page: 'a' }, { page: 'b', block: 'x' }, { page: 'c' }];
    expect(replaceLink(l, { page: 'b', block: 'x' }, { page: 'd' })).toEqual([{ page: 'a' }, { page: 'd' }, { page: 'c' }]);
    expect(replaceLink(l, { page: 'b', block: 'x' }, { page: 'c' })).toEqual([{ page: 'a' }, { page: 'c' }]);
    expect(replaceLink(l, { page: 'zz' }, { page: 'd' })).toBe(l);
    expect(replaceLink(l, { page: 'a' }, { page: 'a' })).toBe(l);
  });
});

describe('the graph, filtered and explained', () => {
  const groups = [
    { id: 'g1', name: 'Work', color: 'teal', parentId: null },
    { id: 'g2', name: 'Sub', color: 'teal', parentId: 'g1' },
    { id: 'g3', name: 'Home', color: 'teal', parentId: null },
  ] as never[];
  const ps = pages(
    page('a', 'A', [text('1', '', { links: [{ page: 'b', block: '9' }, { page: 'c' }] })], { groupId: 'g1', tags: ['x'] }),
    page('b', 'B', [text('9', 'x')], { groupId: 'g2', tags: ['x', 'y'] }),
    page('c', 'C', [], { groupId: 'g3', tags: ['y'] }),
    page('k', 'Kay', [], { kind: 'card', tags: ['x'] }),
  );
  it('says which boxes a link joins', async () => {
    const g = linkGraph(ps);
    expect(g.edges.find((e) => e.to === 'b')?.via).toEqual([{ fromBlock: '1', toBlock: '9' }]);
    expect(g.edges.find((e) => e.to === 'c')?.via).toEqual([{ fromBlock: '1', toBlock: null }]);
  });
  it('keeps only a group and what is inside it, dropping links to what was left out and recounting', async () => {
    const { filterGraph } = await import('../src/lib/links');
    const g = filterGraph(linkGraph(ps, { cards: true }), ps, groups, { groupId: 'g1' });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']); // Sub is inside Work; the card and Home's page are out
    expect(g.edges.map((e) => e.to)).toEqual(['b']);
    expect(g.nodes.find((n) => n.id === 'a')?.links).toBe(1);
  });
  it('keeps only a tag, for pages and cards, and everything when no filter is set', async () => {
    const { filterGraph } = await import('../src/lib/links');
    const full = linkGraph(ps, { cards: true });
    expect(filterGraph(full, ps, groups, { tag: 'x' }).nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'k']);
    expect(filterGraph(full, ps, groups, { groupId: 'g1', tag: 'y' }).nodes.map((n) => n.id)).toEqual(['b']);
    expect(filterGraph(full, ps, groups, {})).toBe(full);
  });
});
