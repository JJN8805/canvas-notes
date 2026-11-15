import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { createCardFolder, deleteCardFolder, fileCard, legacyCardCount, moveCardFolder, moveLegacyCards, renameCardFolder, reorderCardFolder, setCardFolderColor, updateCardFolder } from '../src/store/cardFolders';
import { createCard } from '../src/store/cards';
import { createGroup, useNotes } from '../src/store/notes';

const st = () => useNotes.getState();
const card = (id: string) => st().pages[id];

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useNotes.setState({ filter: { kind: 'all' }, pages: {}, groups: [], cardFolders: [] });
});

describe('making folders and sections', () => {
  it('keeps them apart from the groups that hold pages', () => {
    const folder = createCardFolder('Plants')!;
    createGroup('Work');
    expect(st().cardFolders.map((f) => f.name)).toEqual(['Plants']);
    expect(st().groups.map((g) => g.name)).toEqual(['Work']);
    expect(folder.scope).toBe('cards');
  });
  it('nests sections inside sections, and gives a section its folder’s colour', () => {
    const a = createCardFolder('Plants')!;
    const b = createCardFolder('Indoor', a.id)!;
    const c = createCardFolder('Ferns', b.id)!;
    expect([b.parentId, c.parentId]).toEqual([a.id, b.id]);
    expect([b.color, c.color]).toEqual([a.color, a.color]);
  });
  it('will not put a section in a place that is gone, and never repeats a name beside it', () => {
    expect(createCardFolder('Lost', 'nope')).toBeNull();
    createCardFolder('Plants');
    expect(createCardFolder('plants')!.name).toBe('plants 2');
  });
  it('renames and recolours', () => {
    const a = createCardFolder('Plants')!;
    renameCardFolder(a.id, '  Garden ');
    renameCardFolder(a.id, '   '); // an empty name changes nothing
    setCardFolderColor(a.id, 'plum');
    expect(st().cardFolders[0]).toMatchObject({ name: 'Garden', color: 'plum' });
  });
});

describe('editing a folder or section', () => {
  const one = () => st().cardFolders[0];
  it('sets the name and the description together', () => {
    const a = createCardFolder('Plants')!;
    updateCardFolder(a.id, { name: '  Garden  ', description: '  Things I grow\r\nin pots  ' });
    expect(one()).toMatchObject({ name: 'Garden', description: 'Things I grow\nin pots' });
  });
  it('never lets the name be erased, and changes only what it is given', () => {
    const a = createCardFolder('Plants')!;
    updateCardFolder(a.id, { description: 'About plants' });
    updateCardFolder(a.id, { name: '   ' });
    expect(one()).toMatchObject({ name: 'Plants', description: 'About plants' });
    updateCardFolder(a.id, { name: 'x'.repeat(100) });
    expect(one().name).toHaveLength(60);
    expect(one().description).toBe('About plants');
  });
  it('removes the description when it is emptied, leaving no empty text behind', () => {
    const a = createCardFolder('Plants')!;
    updateCardFolder(a.id, { description: 'About plants' });
    updateCardFolder(a.id, { description: '  ' });
    expect('description' in one()).toBe(false);
  });
  it('limits a description, and ignores a folder that is gone', () => {
    const a = createCardFolder('Plants')!;
    updateCardFolder(a.id, { description: 'y'.repeat(5000) });
    expect(one().description).toHaveLength(2000);
    expect(() => updateCardFolder('nope', { name: 'x' })).not.toThrow();
  });
  it('keeps the description when the section is moved or reordered', () => {
    const a = createCardFolder('A')!;
    const b = createCardFolder('B')!;
    updateCardFolder(b.id, { description: 'keep me' });
    moveCardFolder(b.id, a.id);
    expect(st().cardFolders.find((f) => f.id === b.id)?.description).toBe('keep me');
  });
});

describe('moving', () => {
  it('moves a section with everything in it, and refuses to move one inside itself', () => {
    const a = createCardFolder('A')!;
    const b = createCardFolder('B', a.id)!;
    const c = createCardFolder('C', b.id)!;
    expect(moveCardFolder(a.id, c.id)).toBe(false);
    expect(moveCardFolder(a.id, a.id)).toBe(false);
    expect(moveCardFolder(c.id, null)).toBe(true);
    expect(st().cardFolders.find((f) => f.id === c.id)!.parentId).toBeNull();
    expect(moveCardFolder(b.id, c.id)).toBe(true);
  });
  it('files a card in a folder, takes it out, and ignores a folder that does not exist', () => {
    const a = createCardFolder('A')!;
    const k = createCard('One');
    fileCard(k.id, a.id);
    expect(card(k.id).groupId).toBe(a.id);
    fileCard(k.id, 'nope');
    expect(card(k.id).groupId).toBe(a.id);
    fileCard(k.id, null);
    expect(card(k.id).groupId).toBeNull();
  });
});

describe('order', () => {
  const names = (parent: string | null) => st().cardFolders.filter((f) => f.parentId === parent).map((f) => f.name);
  it('shows sections in the order they were made, and lets you move one up or down', () => {
    const a = createCardFolder('Trips')!;
    const x = createCardFolder('Europe', a.id)!;
    const y = createCardFolder('Asia', a.id)!;
    const z = createCardFolder('Africa', a.id)!;
    expect(names(a.id)).toEqual(['Europe', 'Asia', 'Africa']);
    expect(reorderCardFolder(z.id, -1)).toBe(true);
    expect(names(a.id)).toEqual(['Europe', 'Africa', 'Asia']);
    expect(reorderCardFolder(x.id, -1)).toBe(false); // already first
    expect(reorderCardFolder(y.id, 1)).toBe(false); // already last
    expect(reorderCardFolder(x.id, 1)).toBe(true);
    expect(names(a.id)).toEqual(['Africa', 'Europe', 'Asia']);
  });
  it('puts a section that is moved into a folder after the ones already there', () => {
    const a = createCardFolder('A')!;
    createCardFolder('one', a.id);
    createCardFolder('two', a.id);
    const b = createCardFolder('B')!;
    moveCardFolder(b.id, a.id);
    expect(names(a.id)).toEqual(['one', 'two', 'B']);
  });
});

describe('deleting', () => {
  it('moves the cards and sections inside up one place; nothing is lost', () => {
    const a = createCardFolder('A')!;
    const b = createCardFolder('B', a.id)!;
    const c = createCardFolder('C', b.id)!;
    const k1 = createCard('k1');
    const k2 = createCard('k2');
    fileCard(k1.id, b.id);
    fileCard(k2.id, c.id);
    expect(deleteCardFolder(b.id)).toEqual({ cards: 1, sections: 1 });
    expect(st().cardFolders.map((f) => f.name).sort()).toEqual(['A', 'C']);
    expect(st().cardFolders.find((f) => f.id === c.id)!.parentId).toBe(a.id);
    expect(card(k1.id).groupId).toBe(a.id);
    expect(card(k2.id).groupId).toBe(c.id);
  });
  it('sends a top-level folder’s cards to Unfiled and its sections to the top', () => {
    const a = createCardFolder('A')!;
    const b = createCardFolder('B', a.id)!;
    const k = createCard('k');
    fileCard(k.id, a.id);
    deleteCardFolder(a.id);
    expect(card(k.id).groupId).toBeNull();
    expect(st().cardFolders.find((f) => f.id === b.id)!.parentId).toBeNull();
    expect(deleteCardFolder('nope')).toEqual({ cards: 0, sections: 0 });
  });
});

describe('cards still filed under page groups', () => {
  it('are counted, brought into copies of those groups, and leave the page groups as they were', () => {
    const work = createGroup('Work');
    const ml = createGroup('ML', work.id);
    const k1 = createCard('k1', ml.id);
    const k2 = createCard('k2', work.id);
    createCard('k3');
    expect(legacyCardCount()).toBe(2);
    expect(moveLegacyCards()).toEqual({ folders: 2, cards: 2 });
    const folders = st().cardFolders;
    const fw = folders.find((f) => f.name === 'Work')!;
    const fm = folders.find((f) => f.name === 'ML')!;
    expect(fm.parentId).toBe(fw.id);
    expect(card(k1.id).groupId).toBe(fm.id);
    expect(card(k2.id).groupId).toBe(fw.id);
    expect(st().groups.map((g) => g.name).sort()).toEqual(['ML', 'Work']); // the page groups are untouched
    expect(legacyCardCount()).toBe(0);
    expect(moveLegacyCards()).toEqual({ folders: 0, cards: 0 }); // doing it again changes nothing
  });
});
