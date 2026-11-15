import { describe, expect, it } from 'vitest';
import { cardsAt, cardsInPageGroups, childrenOf, cleanDescription, depthOf, MAX_DESCRIPTION, reordered, folderChoices, folderCounts, folderOfCard, placeName, planLegacyMove, startColor, trailOf, uniqueName, validMoveTargets, type Place } from '../src/lib/cardFolders';
import type { Group, Page } from '../src/types';

const f = (id: string, name: string, parentId: string | null = null, color: Group['color'] = 'teal'): Group => ({ id, name, color, parentId, scope: 'cards' });
const card = (id: string, groupId: string | null = null): Page => ({ id, title: id, kind: 'card', groupId, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 1 });

// Plants
//   Indoor
//     Ferns
//   Outdoor
// Recipes
const folders = [f('plants', 'Plants'), f('indoor', 'Indoor', 'plants'), f('ferns', 'Ferns', 'indoor'), f('outdoor', 'Outdoor', 'plants'), f('recipes', 'Recipes')];
const cards = [card('c1', 'plants'), card('c2', 'indoor'), card('c3', 'ferns'), card('c4', 'ferns'), card('c5', 'recipes'), card('c6'), card('c7', 'gone')];
const ids = (list: Page[]) => list.map((c) => c.id).sort();

describe('naming', () => {
  it('calls the top level folders and everything inside them sections', () => {
    expect([0, 1, 2, 5].map(placeName)).toEqual(['folder', 'section', 'section', 'section']);
    expect(depthOf(folders, 'plants')).toBe(0);
    expect(depthOf(folders, 'indoor')).toBe(1);
    expect(depthOf(folders, 'ferns')).toBe(2);
  });
});

describe('what is in a place', () => {
  it('shows only what is directly in a folder, or everything inside it when asked', () => {
    const at = (place: Place, nested = false) => ids(cardsAt(cards, folders, place, { nested }));
    expect(at({ kind: 'folder', id: 'plants' })).toEqual(['c1']);
    expect(at({ kind: 'folder', id: 'plants' }, true)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(at({ kind: 'folder', id: 'indoor' }, true)).toEqual(['c2', 'c3', 'c4']);
    expect(at({ kind: 'folder', id: 'ferns' })).toEqual(['c3', 'c4']);
    expect(at({ kind: 'folder', id: 'outdoor' })).toEqual([]);
  });
  it('calls a card unfiled when it has no folder, or points at something that is not one', () => {
    expect(ids(cardsAt(cards, folders, { kind: 'unfiled' }))).toEqual(['c6', 'c7']);
    expect(folderOfCard(card('x', 'gone'), folders)).toBeNull();
    expect(folderOfCard(card('x', 'ferns'), folders)).toBe('ferns');
    expect(ids(cardsAt(cards, folders, { kind: 'all' }))).toHaveLength(7);
  });
});

describe('the tree', () => {
  it('lists the sections directly inside a folder in the order they were made, and the folders at the top', () => {
    expect(childrenOf(folders, null).map((x) => x.id)).toEqual(['plants', 'recipes']);
    expect(childrenOf([f('b', 'B'), f('a', 'A')], null).map((x) => x.id)).toEqual(['b', 'a']); // not alphabetical
    expect(childrenOf(folders, 'plants').map((x) => x.id)).toEqual(['indoor', 'outdoor']);
    expect(childrenOf(folders, 'ferns')).toEqual([]);
  });
  it('counts the cards in a folder including those in its sections', () => {
    const n = folderCounts(cards, folders);
    expect(Object.fromEntries(n)).toEqual({ plants: 4, indoor: 3, ferns: 2, outdoor: 0, recipes: 1 });
  });
  it('gives the path from the top, and survives a loop', () => {
    expect(trailOf(folders, 'ferns').map((x) => x.name)).toEqual(['Plants', 'Indoor', 'Ferns']);
    expect(trailOf(folders, 'nope')).toEqual([]);
    const loop = [f('a', 'A', 'b'), f('b', 'B', 'a')];
    expect(() => trailOf(loop, 'a')).not.toThrow();
    expect(() => folderCounts([card('x', 'a')], loop)).not.toThrow();
  });
  it('offers every place for a picker, in tree order, named by path', () => {
    expect(folderChoices(folders).map((c) => `${c.depth}:${c.label}`)).toEqual(['0:Plants', '1:Plants / Indoor', '2:Plants / Indoor / Ferns', '1:Plants / Outdoor', '0:Recipes']);
  });
  it('never offers to move a place into itself or anything inside it', () => {
    expect(validMoveTargets(folders, 'plants').map((x) => x.id).sort()).toEqual(['recipes']);
    expect(validMoveTargets(folders, 'ferns').map((x) => x.id).sort()).toEqual(['indoor', 'outdoor', 'plants', 'recipes']);
  });
});

describe('arranging', () => {
  it('moves a section up or down among its neighbours only, and says when it is already at the end', () => {
    expect(childrenOf(reordered(folders, 'outdoor', -1)!, 'plants').map((x) => x.id)).toEqual(['outdoor', 'indoor']);
    expect(childrenOf(reordered(folders, 'plants', 1)!, null).map((x) => x.id)).toEqual(['recipes', 'plants']);
    expect(reordered(folders, 'indoor', -1)).toBeNull(); // first in Plants
    expect(reordered(folders, 'outdoor', 1)).toBeNull(); // last in Plants
    expect(reordered(folders, 'ferns', 1)).toBeNull(); // alone in Indoor
    expect(reordered(folders, 'nope', 1)).toBeNull();
  });
});

describe('descriptions', () => {
  it('are trimmed, keep their line breaks, and are never longer than the limit', () => {
    expect(cleanDescription('  Plants for the \r\nwindow sill \n')).toBe('Plants for the \nwindow sill');
    expect(cleanDescription('   ')).toBe('');
    expect(cleanDescription('x'.repeat(MAX_DESCRIPTION + 50))).toHaveLength(MAX_DESCRIPTION);
    expect(cleanDescription('one\n\ntwo')).toBe('one\n\ntwo');
  });
});

describe('new folders', () => {
  it('avoids the name of a sibling, ignoring case, but not of a folder elsewhere', () => {
    expect(uniqueName(folders, null, 'plants')).toBe('plants 2');
    expect(uniqueName([...folders, f('p2', 'Plants 2')], null, 'Plants')).toBe('Plants 3');
    expect(uniqueName(folders, 'plants', 'Recipes')).toBe('Recipes');
    expect(uniqueName(folders, null, '   ')).toBe('Untitled');
    expect(uniqueName(folders, null, 'x'.repeat(100))).toHaveLength(60);
  });
  it('starts a section in its folder’s colour and a folder in a colour not used yet', () => {
    expect(startColor([f('p', 'P', null, 'plum')], 'p')).toBe('plum');
    const used = [f('p', 'P', null, 'teal')];
    expect(startColor(used, null)).not.toBe('teal');
  });
});

describe('cards filed under page groups from before', () => {
  const groups: Group[] = [
    { id: 'g-work', name: 'Work', color: 'ultra', parentId: null },
    { id: 'g-ml', name: 'ML', color: 'moss', parentId: 'g-work' },
    { id: 'g-unused', name: 'Unused', color: 'brick', parentId: null },
  ];
  const old = [card('a', 'g-ml'), card('b', 'g-work'), card('c', null), card('d', 'plants')];
  it('finds them, leaving cards already in a folder alone', () => {
    expect(ids(cardsInPageGroups(old, groups, folders))).toEqual(['a', 'b']);
  });
  it('plans folders that copy the groups the cards use, with the same nesting, and files the cards', () => {
    let n = 0;
    const plan = planLegacyMove(old, groups, folders, () => `new${++n}`);
    expect(plan.create.map((x) => [x.name, x.color, x.scope, x.parentId === null ? null : plan.create.find((y) => y.id === x.parentId)?.name])).toEqual([
      ['Work', 'ultra', 'cards', null],
      ['ML', 'moss', 'cards', 'Work'],
    ]);
    const idOf = (name: string) => plan.create.find((x) => x.name === name)!.id;
    expect(Object.fromEntries(plan.assign)).toEqual({ a: idOf('ML'), b: idOf('Work') });
    expect(plan.create.some((x) => x.name === 'Unused')).toBe(false); // a group no card uses is not copied
  });
  it('names a copy so it does not clash with a folder already there', () => {
    const plan = planLegacyMove([card('a', 'g-work')], groups, [f('x', 'Work')], () => 'n1');
    expect(plan.create[0].name).toBe('Work 2');
  });
  it('plans nothing when no card is filed under a page group', () => {
    const plan = planLegacyMove([card('c', null)], groups, folders, () => 'n');
    expect(plan.create).toEqual([]);
    expect(plan.assign.size).toBe(0);
  });
});
