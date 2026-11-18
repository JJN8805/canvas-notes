import { beforeEach, describe, expect, it, vi } from 'vitest';

const toasts: string[] = [];
vi.mock('../src/store/ui', () => ({ toast: (m: string) => toasts.push(m), confirmDanger: async () => true, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { pagesWord, pickedIn, toggleId } from '../src/lib/selection';
import { archivable, archivePages, deletePages, movePages } from '../src/store/bulkPages';
import { cancelSelect, selectAllOf, startSelect, toggleSelected, useSelect } from '../src/store/librarySelect';
import { createPage, useNotes } from '../src/store/notes';

const st = () => useNotes.getState();

describe('picking pages (pure rules)', () => {
  it('toggles an id in and out, keeping the order of picking', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('applies to what is still shown, in the shown order', () => {
    expect(pickedIn(['c', 'a', 'gone'], ['a', 'b', 'c'])).toEqual(['a', 'c']);
  });
  it('says how many', () => {
    expect([pagesWord(1), pagesWord(3)]).toEqual(['1 page', '3 pages']);
  });
});

describe('the picking state', () => {
  beforeEach(() => cancelSelect());
  it('starts, toggles, picks all and cancels', () => {
    startSelect('a');
    expect(useSelect.getState()).toEqual({ on: true, ids: ['a'] });
    toggleSelected('b');
    toggleSelected('a');
    expect(useSelect.getState().ids).toEqual(['b']);
    selectAllOf(['x', 'y']);
    expect(useSelect.getState().ids).toEqual(['x', 'y']);
    cancelSelect();
    expect(useSelect.getState()).toEqual({ on: false, ids: [] });
  });
});

describe('doing something with the picked pages together', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    toasts.length = 0;
    useNotes.setState({ filter: { kind: 'all' }, pages: {}, groups: [], cardFolders: [], trash: [] });
  });
  it('archives them with one message, skips ones that cannot be archived, and Undo brings them all back', () => {
    const a = createPage({ title: 'A' });
    const b = createPage({ title: 'B' });
    const day = createPage({ title: 'Day', dailyDate: '2026-11-18' });
    expect(archivable([a.id, b.id, day.id])).toEqual([a.id, b.id]);
    expect(archivePages([a.id, b.id, day.id])).toBe(2);
    expect(st().pages[a.id].archived && st().pages[b.id].archived).toBe(true);
    expect(st().pages[day.id].archived).toBeUndefined();
    expect(toasts.filter((t) => t.startsWith('Archived'))).toEqual(['Archived 2 pages']); // one message, not one per page
  });
  it('moves them to a group, or out of any', () => {
    const a = createPage({ title: 'A' });
    const b = createPage({ title: 'B' });
    movePages([a.id, b.id], 'g1', 'Work');
    expect([st().pages[a.id].groupId, st().pages[b.id].groupId]).toEqual(['g1', 'g1']);
    expect(toasts.at(-1)).toBe('Moved 2 pages to Work');
    movePages([a.id], null, '');
    expect(st().pages[a.id].groupId).toBeNull();
  });
  it('deletes them after one question, with one message', async () => {
    const a = createPage({ title: 'A' });
    const b = createPage({ title: 'B' });
    expect(await deletePages([a.id, b.id])).toBe(2);
    expect(st().pages[a.id]).toBeUndefined();
    expect(toasts.filter((t) => /^Deleted/.test(t))).toEqual(['Deleted 2 pages']);
    expect(await deletePages([])).toBe(0);
  });
});
