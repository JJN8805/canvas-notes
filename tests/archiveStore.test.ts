import { beforeEach, describe, expect, it, vi } from 'vitest';

const toasts: string[] = [];
vi.mock('../src/store/ui', () => ({ toast: (m: string) => toasts.push(m), openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { archivePage, restorePage } from '../src/store/archive';
import { createPage, duplicatePage, useNotes } from '../src/store/notes';

const st = () => useNotes.getState();

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  toasts.length = 0;
  useNotes.setState({ filter: { kind: 'all' }, pages: {}, groups: [], cardFolders: [] });
});

describe('archiving and restoring a page', () => {
  it('archives a page without touching what it holds or when it was last edited', () => {
    const p = createPage({ title: 'Plan' });
    const before = { ...st().pages[p.id] };
    expect(archivePage(p.id)).toBe(true);
    const after = st().pages[p.id];
    expect(after.archived).toBe(true);
    expect(after.updated).toBe(before.updated);
    expect(after.blocks).toEqual(before.blocks);
    expect(after.title).toBe('Plan');
    expect(toasts.at(-1)).toContain('Archived “Plan”');
  });
  it('restores it, and does nothing twice', () => {
    const p = createPage({ title: 'Plan' });
    expect(restorePage(p.id)).toBe(false); // not archived yet
    archivePage(p.id);
    expect(archivePage(p.id)).toBe(false); // already archived
    expect(restorePage(p.id)).toBe(true);
    expect(st().pages[p.id].archived).toBeUndefined();
    expect(toasts.at(-1)).toContain('Restored “Plan”');
  });
  it('refuses a journal day, a template and a page that does not exist', () => {
    const day = createPage({ title: 'Day', dailyDate: '2026-11-18' });
    const tpl = createPage({ title: 'T', kind: 'template' });
    expect(archivePage(day.id)).toBe(false);
    expect(archivePage(tpl.id)).toBe(false);
    expect(archivePage('nope')).toBe(false);
    expect(st().pages[day.id].archived).toBeUndefined();
  });
  it('can be quiet (no toast)', () => {
    const p = createPage({ title: 'Plan' });
    archivePage(p.id, { announce: false });
    expect(toasts).toEqual([]);
  });
  it('a copy of an archived page is a normal page in the library', () => {
    const p = createPage({ title: 'Plan' });
    archivePage(p.id, { announce: false });
    const copy = duplicatePage(p.id)!;
    expect(copy.archived).toBeUndefined();
    expect(st().pages[copy.id].archived).toBeUndefined();
  });
});
