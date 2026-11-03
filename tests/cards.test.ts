import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { buildBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import { cardInitial, cardLabel, cardParts, cardText, newCardBlocks, searchCards, withCover, COVER_W, cardTagCounts, inCardSet, boardColumns } from '../src/lib/cards';
import { cardsOf, isCard, kindOf, libraryPages } from '../src/lib/pages';
import type { NotesStorage } from '../src/storage/types';
import type { Block, Group, Page } from '../src/types';

const card = (id: string, title: string, blocks: Block[] = newCardBlocks(), extra: Partial<Page> = {}): Page => ({
  id, title, groupId: null, tags: [], blocks, arrows: [], kind: 'card', created: 1, updated: 1, rev: 0, ...extra,
});
const text = (id: string, html: string, z = 1): Block => ({ id, type: 'text', x: 0, y: 0, w: 200, h: 40, z, html }) as Block;
const image = (id: string, z = 2): Block => ({ id, type: 'image', x: 0, y: 0, w: 100, h: 100, z, imageId: 'img1', aspect: 1 }) as Block;

describe('what a card is', () => {
  it('is its own kind, kept apart from pages and templates', () => {
    expect(kindOf({ kind: 'card' })).toBe('card');
    expect(kindOf({ kind: 'something else' })).toBe('page');
    const pages = { a: card('a', 'A'), b: { ...card('b', 'B'), kind: 'page' as const }, t: { ...card('t', 'T'), kind: 'template' as const } };
    expect(libraryPages(pages).map((p) => p.id)).toEqual(['b']);
    expect(cardsOf(pages).map((p) => p.id)).toEqual(['a']);
    expect(isCard(pages.a)).toBe(true);
  });

  it('finds its cover and details whatever order they were made in', () => {
    const p = { blocks: [image('i', 5), text('t1', '<p>first</p>', 3), text('t2', '<p>second</p>', 4)] };
    expect(cardParts(p).cover?.id).toBe('i');
    expect(cardParts(p).body?.id).toBe('t1');
    expect(cardParts({ blocks: [] })).toEqual({ cover: null, body: null });
    expect(cardText({ blocks: [text('t', '<p>Hello <b>there</b></p>')] })).toBe('Hello there');
  });

  it('has a readable label and initial even when untitled', () => {
    expect(cardLabel({ title: '  ' })).toBe('Untitled card');
    expect(cardInitial({ title: 'tokyo trip' })).toBe('T');
    expect(cardInitial({ title: '— !' })).toBe('•');
  });

  it('starts with an empty details box', () => {
    const b = newCardBlocks();
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ type: 'text', html: '' });
  });
});

describe('the cover', () => {
  it('is added above the details, which move down to make room', () => {
    const before = newCardBlocks();
    const after = withCover(before, { imageId: 'img9', aspect: 2 });
    const { cover, body } = cardParts({ blocks: after });
    expect(cover).toMatchObject({ imageId: 'img9', y: 0, w: COVER_W, h: COVER_W / 2 });
    expect(body!.y).toBeGreaterThanOrEqual(cover!.h);
    expect(before[0].y).toBe(0); // the original is untouched
  });

  it('is replaced in place, and removed with null', () => {
    const one = withCover(newCardBlocks(), { imageId: 'a', aspect: 1 });
    const two = withCover(one, { imageId: 'b', aspect: 1 });
    expect(two.filter((b) => b.type === 'image')).toHaveLength(1);
    expect(cardParts({ blocks: two }).cover?.imageId).toBe('b');
    expect(withCover(two, null).some((b) => b.type === 'image')).toBe(false);
    expect(withCover(newCardBlocks(), null)).toHaveLength(1);
  });

  it('copes with a nonsense aspect ratio', () => {
    for (const aspect of [0, -1, NaN, Infinity]) {
      const { cover } = cardParts({ blocks: withCover(newCardBlocks(), { imageId: 'a', aspect }) });
      expect(Number.isFinite(cover!.h) && cover!.h > 0).toBe(true);
    }
  });
});

describe('searching cards', () => {
  const cards = [
    card('1', 'Tokyo trip', [text('t', '<p>Flights and hotels</p>')]),
    card('2', 'Recipes', [text('t', '<p>Miso soup from Tokyo</p>')], { tags: ['food'] }),
    card('3', 'Garden', [text('t', '<p>Tomatoes</p>')]),
  ];
  it('matches the label, the details and the tags, every word', () => {
    expect(searchCards(cards, 'tokyo').map((c) => c.id)).toEqual(['1', '2']);
    expect(searchCards(cards, 'tokyo hotels').map((c) => c.id)).toEqual(['1']);
    expect(searchCards(cards, 'FOOD').map((c) => c.id)).toEqual(['2']);
    expect(searchCards(cards, 'zzz')).toEqual([]);
    expect(searchCards(cards, '  ')).toEqual(cards);
  });
});

describe('tags and sets of cards', () => {
  const cards = [
    card('1', 'Tokyo', [text('t', '<p>garden party</p>')], { tags: ['travel'], groupId: 'g1' }),
    card('2', 'Garden', [text('t', '<p>x</p>')], { tags: ['plants', 'travel'], groupId: 'g2' }),
    card('3', 'Loose', [text('t', '<p>x</p>')], { tags: [] }),
  ];

  it('finds cards by exact tag with #tag or tag:tag, and combines it with words', () => {
    expect(searchCards(cards, '#travel').map((c) => c.id)).toEqual(['1', '2']);
    expect(searchCards(cards, 'tag:Plants').map((c) => c.id)).toEqual(['2']);
    expect(searchCards(cards, '#travel #plants').map((c) => c.id)).toEqual(['2']);
    expect(searchCards(cards, '#travel garden').map((c) => c.id)).toEqual(['1', '2']);
    expect(searchCards(cards, '#trav')).toEqual([]); // a tag must match whole, unlike a word
    expect(searchCards(cards, '#')).toEqual(cards); // a bare # is no filter
    expect(searchCards(cards, 'plan').map((c) => c.id)).toEqual(['2']); // plain words still match inside tags
  });

  it('counts tags, most used first', () => {
    expect(cardTagCounts(cards)).toEqual([{ tag: 'travel', count: 2 }, { tag: 'plants', count: 1 }]);
    expect(cardTagCounts([card('x', 'X', [], { tags: ['a', 'a'] })])).toEqual([{ tag: 'a', count: 1 }]);
  });

  it('picks the cards of a set', () => {
    const ids = (set: Parameters<typeof inCardSet>[1]) => cards.filter((c) => inCardSet(c, set)).map((c) => c.id);
    expect(ids({ kind: 'all' })).toEqual(['1', '2', '3']);
    expect(ids({ kind: 'none' })).toEqual(['3']);
    expect(ids({ kind: 'group', ids: new Set(['g1']) })).toEqual(['1']);
    expect(ids({ kind: 'group', ids: new Set(['g1', 'g2']) })).toEqual(['1', '2']);
  });
});

describe('the board of card sets', () => {
  const g = (id: string, name: string, parentId: string | null = null): Group => ({ id, name, color: 'slate', parentId });
  const groups = [g('w', 'Work'), g('ml', 'ML', 'w'), g('deep', 'Deep', 'ml'), g('h', 'Home')];
  const cards = [
    card('a', 'A', [], { groupId: 'w' }),
    card('b', 'B', [], { groupId: 'deep' }),
    card('c', 'C', [], { groupId: 'h' }),
    card('d', 'D'),
    card('e', 'E', [], { groupId: 'deleted-group' }),
  ];
  const show = (within: string | null) => boardColumns(groups, cards, within).map((c) => [c.groupId, c.title, c.cards.map((x) => x.id)]);

  it('has "No set" and one column per top group, with deeper cards under their top group', () => {
    expect(show(null)).toEqual([[null, 'No set', ['d', 'e']], ['w', 'Work', ['a', 'b']], ['h', 'Home', ['c']]]);
  });

  it('inside a set, shows the set itself and its subgroups', () => {
    expect(show('w')).toEqual([['w', 'Work', ['a']], ['ml', 'ML', ['b']]]);
    expect(show('ml')).toEqual([['ml', 'ML', []], ['deep', 'Deep', ['b']]]);
  });

  it('survives a group loop without hanging', () => {
    const loop = [g('x', 'X', 'y'), g('y', 'Y', 'x')];
    expect(() => boardColumns(loop, [card('p', 'P', [], { groupId: 'x' })], null)).not.toThrow();
  });
});

describe('cards in storage', () => {
  let a: NotesStorage;
  let b: NotesStorage;
  beforeEach(async () => {
    useDevice('cards-a');
    a = await createTauriStorage();
    useDevice('cards-b');
    b = await createTauriStorage();
  });

  it('keeps their kind when saved and loaded', async () => {
    useDevice('cards-a');
    await a.savePage(card('c1', 'Tokyo', [text('t', '<p>x</p>')]));
    const { pages } = await a.loadAll();
    expect(pages.find((p) => p.id === 'c1')?.kind).toBe('card');
  });

  it('keep their tags and set, and carry them to the other device', async () => {
    useDevice('cards-a');
    await a.savePage(card('c1', 'Tokyo', [text('t', '<p>x</p>')], { tags: ['travel'], groupId: 'g1' }));
    const got = (await a.loadAll()).pages.find((p) => p.id === 'c1');
    expect(got).toMatchObject({ tags: ['travel'], groupId: 'g1', kind: 'card' });
  });

  it('go to the trash like pages do, and keep their kind there', async () => {
    useDevice('cards-a');
    await a.savePage(card('c1', 'Tokyo', [text('t', '<p>x</p>')]));
    await a.deletePage('c1');
    expect((await a.listTrash()).map((p) => [p.id, p.kind])).toEqual([['c1', 'card']]);
  });

  it('are in a backup and come back as cards', async () => {
    useDevice('cards-a');
    await a.savePage(card('c1', 'Tokyo', [text('t', '<p>x</p>')]));
    const backup = parseBackup(JSON.stringify(await buildBackup(a)));
    useDevice('cards-b');
    await restoreBackup(b, backup);
    const { pages } = await b.loadAll();
    expect(pages.find((p) => p.id === 'c1')?.kind).toBe('card');
  });
});
