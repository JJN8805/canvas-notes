import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryGraph } from './graphdb';

vi.mock('../src/components/library/Thumbnail', () => ({ StaticBody: () => null }));
vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { GraphMirror } from '../src/graph/mirror';
import { pageToMarkdown } from '../src/export/export';
import { cardLabel, cardText, newCardBlocks } from '../src/lib/cards';
import { isCard, libraryPages } from '../src/lib/pages';
import { searchPages } from '../src/lib/search';
import { BLOCK_LABEL, blockText, isFixedHeight } from '../src/lib/util';
import { addCardBox } from '../src/store/cards';
import { deleteBlocks, undo, useNotes } from '../src/store/notes';
import type { Block, CardBlock, Page } from '../src/types';

const card = (id: string, title: string, html = ''): Page => ({
  id, title, groupId: null, tags: [], arrows: [], created: 1, updated: 1, rev: 1, kind: 'card',
  blocks: newCardBlocks().map((b) => (b.type === 'text' ? { ...b, html } : b)),
});
const page = (id: string, blocks: Block[] = []): Page => ({ id, title: 'My page', groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 1 });
const box = (id: string, cardId: string, extra: Partial<CardBlock> = {}): CardBlock => ({ id, type: 'card', x: 0, y: 0, w: 220, h: 40, z: 1, cardId, ...extra });

beforeEach(() => {
  // The store schedules saves with window timers; in Node, let `window` be the global object (as the sticky tests do).
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  useNotes.setState({ pages: { c1: card('c1', 'Garden', '<p>Tomatoes and basil.</p>'), p: page('p') } });
});

describe('a card on a page', () => {
  it('is a box that points at the card, and is one undo step', () => {
    const id = addCardBox('p', 'c1', { x: 40, y: 60 });
    const made = useNotes.getState().pages.p.blocks.find((b) => b.id === id) as CardBlock;
    expect(made).toMatchObject({ type: 'card', cardId: 'c1', w: 220, x: 40, y: 60 });
    expect(undo('p')).toBe(true);
    expect(useNotes.getState().pages.p.blocks).toHaveLength(0);
  });

  it('leaves the card alone when the box is deleted: the card is a separate item', () => {
    const id = addCardBox('p', 'c1', { x: 0, y: 0 });
    deleteBlocks('p', [id]);
    expect(useNotes.getState().pages.p.blocks).toHaveLength(0);
    expect(useNotes.getState().pages.c1).toBeDefined();
    expect(isCard(useNotes.getState().pages.c1)).toBe(true);
  });

  it('can show the same card on several pages, and never makes the card a page', () => {
    useNotes.setState((s) => ({ pages: { ...s.pages, q: page('q') } }));
    addCardBox('p', 'c1', { x: 0, y: 0 });
    addCardBox('q', 'c1', { x: 0, y: 0 });
    const pages = useNotes.getState().pages;
    expect((pages.p.blocks[0] as CardBlock).cardId).toBe('c1');
    expect((pages.q.blocks[0] as CardBlock).cardId).toBe('c1');
    expect(libraryPages(pages).map((p) => p.id).sort()).toEqual(['p', 'q']); // the card stays out of the page library
  });

  it('grows with its content like a text box, and is named "Card"', () => {
    expect(isFixedHeight(box('b', 'c1'))).toBe(false);
    expect(BLOCK_LABEL.card).toBe('Card');
    expect(blockText(box('b', 'c1'))).toBe(''); // the card's words belong to the card, not to this page's search text
  });

  it('is found by has:card', () => {
    const pages = [page('with', [box('b', 'c1')]), page('without')];
    expect(searchPages(pages, 'has:card').map((p) => p.id)).toEqual(['with']);
  });

  it('is stored in the link graph as an embed, with its real kind kept', async () => {
    const g = await memoryGraph();
    const mirror = new GraphMirror(g.repo);
    await mirror.page({ id: 'p', title: 'My page', groupId: null, tags: [], blocks: [box('b', 'c1')], arrows: [], created: 5 });
    const rows = await g.repo.listBlocks('p');
    expect(rows.map((r) => [r.id, r.type])).toEqual([['b', 'embed']]);
    expect(JSON.parse(rows[0].content)).toMatchObject({ kind: 'card', cardId: 'c1' });
  });
});

describe('exporting a page with a card', () => {
  const info = (b: CardBlock) => {
    const p = useNotes.getState().pages[b.cardId];
    return p && isCard(p) ? { label: cardLabel(p), text: cardText(p) } : null;
  };

  it('writes the card’s label and details as a quote', () => {
    const md = pageToMarkdown(page('p', [box('b', 'c1')]), () => '', '', () => '', info);
    expect(md).toContain('> 🗂️ **Garden**\n> Tomatoes and basil.');
  });

  it('skips a card that is gone, without failing', () => {
    const md = pageToMarkdown(page('p', [box('b', 'deleted-card')]), () => '', '', () => '', info);
    expect(md).toBe('# My page\n');
    expect(() => pageToMarkdown(page('p', [box('b', 'c1')]), () => '')).not.toThrow(); // no card lookup given
  });

  it('keeps the card’s markdown characters from breaking the line', () => {
    useNotes.setState((s) => ({ pages: { ...s.pages, c2: card('c2', 'A *bold* `move`', '<p>line one</p><p>line two</p>') } }));
    const md = pageToMarkdown(page('p', [box('b', 'c2')]), () => '', '', () => '', info);
    expect(md).toContain('> 🗂️ **A bold move**\n> line one\n> line two');
  });
});
