import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);
vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { createTauriStorage } from '../src/storage/tauri';
import type { NotesStorage } from '../src/storage/types';
import { addDays, dailyPageFor, dailyTitle, datesWithPages, dateKey, findDailyDuplicates, fromKey, isTodayShortcut, monthGrid, monthTitle } from '../src/lib/daily';
import { BUILTIN_IDS, builtinTemplates } from '../src/lib/builtinTemplates';
import { libraryPages } from '../src/lib/pages';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import { history } from '../src/store/history';
import { usePrefs } from '../src/store/prefs';
import { DAILY_GROUP_ID, openDailyPage, resolveDailyDuplicates, restoreFromTrash, useNotes } from '../src/store/notes';
import type { Page } from '../src/types';

const base = (extra: Partial<Page>): Page => ({ id: 'x', title: '', groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 1, ...extra });
const templates = () => Object.fromEntries(builtinTemplates().map((r) => [r.id, { ...r, rev: 0 } as Page]));
const live = () => libraryPages(useNotes.getState().pages);

describe('dates', () => {
  it('uses the local calendar date, not UTC', () => {
    // 23:30 on 19 Oct in whatever time zone this runs in is still the 19th locally.
    expect(dateKey(new Date(2026, 9, 19, 23, 30))).toBe('2026-10-19');
    expect(dateKey(new Date(2026, 9, 19, 0, 5))).toBe('2026-10-19');
  });

  it('titles a day in English, the same everywhere', () => {
    expect(dailyTitle('2026-10-19')).toBe('Mon, 19 Oct 2026');
    expect(dailyTitle('2026-01-01')).toBe('Thu, 1 Jan 2026');
    expect(dailyTitle('2024-02-29')).toBe('Thu, 29 Feb 2024');
  });

  it('steps a day at a time across months, years, leap days and clock changes', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    // Dates around common daylight-saving changes move by exactly one day.
    for (const d of ['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01', '2026-04-05']) {
      expect(addDays(addDays(d, 1), -1)).toBe(d);
      expect(fromKey(addDays(d, 1)).getDate()).not.toBe(fromKey(d).getDate());
    }
    expect(addDays('2026-10-19', 0)).toBe('2026-10-19');
  });

  it('lays a month out in weeks starting Monday', () => {
    const g = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(g[0].map((c) => c.day)).toEqual([28, 29, 30, 1, 2, 3, 4]);
    expect(g[0].map((c) => c.inMonth)).toEqual([false, false, false, true, true, true, true]);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat().filter((c) => c.inMonth)).toHaveLength(31);
    expect(g.flat().find((c) => c.key === '2026-10-19')?.inMonth).toBe(true);
    expect(monthTitle(2026, 9)).toBe('October 2026');
    expect(monthGrid(2027, 1)).toHaveLength(4); // Feb 2027 starts on a Monday and has 28 days
  });

  it('recognises Ctrl+Alt+D and nothing else', () => {
    const e = { code: 'KeyD', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false };
    expect(isTodayShortcut(e)).toBe(true);
    expect(isTodayShortcut({ ...e, altKey: false })).toBe(false);
    expect(isTodayShortcut({ ...e, ctrlKey: false })).toBe(false);
    expect(isTodayShortcut({ ...e, shiftKey: true })).toBe(false);
    expect(isTodayShortcut({ ...e, code: 'KeyS' })).toBe(false);
    expect(isTodayShortcut({ ...e, repeat: true })).toBe(false);
  });
});

describe('opening a daily page', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    usePrefs.setState({ dailyTemplate: null });
    useNotes.setState({ filter: { kind: 'tag', tag: 'work' }, groups: [], pages: templates() });
  });
  afterEach(() => vi.restoreAllMocks());

  it('creates nothing until you open a day', () => {
    expect(live()).toHaveLength(0);
  });

  it('creates the page once per date, however many times it is opened', () => {
    const a = openDailyPage('2026-10-19');
    const b = openDailyPage('2026-10-19');
    expect(b.id).toBe(a.id);
    expect(live()).toHaveLength(1);
    const c = openDailyPage('2026-10-20');
    expect(c.id).not.toBe(a.id);
    expect(live()).toHaveLength(2);
  });

  it('is titled by the date and holds the date, with no tags and no group (the Journal holds it), even when opened while viewing a tag', () => {
    const p = openDailyPage('2026-10-19');
    expect(p).toMatchObject({ title: 'Mon, 19 Oct 2026', dailyDate: '2026-10-19', groupId: null, tags: [], kind: 'page' });
  });

  it('makes no Daily group any more, and leaves one that older versions made alone', () => {
    openDailyPage('2026-10-19');
    expect(useNotes.getState().groups).toEqual([]);
    useNotes.setState({ groups: [{ id: DAILY_GROUP_ID, name: 'Daily', color: 'ultra', parentId: null }] });
    openDailyPage('2026-10-20');
    expect(useNotes.getState().groups).toEqual([{ id: DAILY_GROUP_ID, name: 'Daily', color: 'ultra', parentId: null }]);
    expect(Object.values(useNotes.getState().pages).filter((p) => p.dailyDate).every((p) => p.groupId === null)).toBe(true);
  });

  it('starts from the built-in Daily page template, as an independent copy', () => {
    const tpl = useNotes.getState().pages[BUILTIN_IDS.daily];
    const p = openDailyPage('2026-10-19');
    expect(p.blocks).toHaveLength(tpl.blocks.length);
    expect(p.blocks.some((b) => tpl.blocks.some((t) => t.id === b.id))).toBe(false);
    expect(useNotes.getState().pages[BUILTIN_IDS.daily]).toBe(tpl);
  });

  it('starts from the template chosen in Settings, or blank', () => {
    usePrefs.setState({ dailyTemplate: BUILTIN_IDS.todo });
    expect(openDailyPage('2026-10-19').blocks).toHaveLength(useNotes.getState().pages[BUILTIN_IDS.todo].blocks.length);
    usePrefs.setState({ dailyTemplate: 'none' });
    expect(openDailyPage('2026-10-20').blocks).toHaveLength(0);
  });

  it('falls back to a blank page when the chosen and the built-in templates are gone', () => {
    useNotes.setState((s) => {
      delete s.pages[BUILTIN_IDS.daily];
    });
    const p = openDailyPage('2026-10-19');
    expect(p).toMatchObject({ title: 'Mon, 19 Oct 2026', blocks: [] });
  });

  it('keeps templates out of the dates that have pages', () => {
    openDailyPage('2026-10-19');
    expect([...datesWithPages(useNotes.getState().pages)]).toEqual(['2026-10-19']);
    expect(dailyPageFor(useNotes.getState().pages, '2026-10-19')?.title).toBe('Mon, 19 Oct 2026');
    expect(dailyPageFor(useNotes.getState().pages, '2026-10-21')).toBeNull();
  });

  it('opens an existing page for a date rather than a new one, even one not made today', () => {
    useNotes.setState((s) => {
      s.pages.old = base({ id: 'old', title: 'Old entry', dailyDate: '2025-01-02' });
    });
    expect(openDailyPage('2025-01-02').id).toBe('old');
    expect(live()).toHaveLength(1);
  });
});

describe('two devices making the same day', () => {
  const a = base({ id: 'a', title: 'Mon, 19 Oct 2026', dailyDate: '2026-10-19', created: 100 });
  const b = base({ id: 'b', title: 'Mon, 19 Oct 2026', dailyDate: '2026-10-19', created: 200 });
  const c = base({ id: 'c', title: 'Mon, 19 Oct 2026', dailyDate: '2026-10-19', created: 100 });

  it('keeps the oldest as the daily page, then the smaller id', () => {
    expect(findDailyDuplicates([a, b])).toEqual([{ date: '2026-10-19', winner: 'a', losers: ['b'] }]);
    expect(findDailyDuplicates([a, c, b])).toEqual([{ date: '2026-10-19', winner: 'a', losers: ['c', 'b'] }]);
  });

  it('gives the same answer whatever order the pages come in, so both devices agree', () => {
    const forward = findDailyDuplicates([a, b, c]);
    const backward = findDailyDuplicates([c, b, a]);
    expect(backward).toEqual(forward);
  });

  it('ignores single dates, templates, ordinary pages and bad dates', () => {
    const tpl = base({ id: 't', kind: 'template', dailyDate: '2026-10-19', created: 1 });
    expect(findDailyDuplicates([a, tpl])).toEqual([]);
    expect(findDailyDuplicates([a, base({ id: 'n', dailyDate: null }), base({ id: 'm', dailyDate: null })])).toEqual([]);
    expect(findDailyDuplicates([a, base({ id: 'z', dailyDate: 'soon' as never })])).toEqual([]);
  });

  describe('in the store', () => {
    beforeEach(() => {
      vi.stubGlobal('window', globalThis);
      vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      useNotes.setState({ filter: { kind: 'all' }, groups: [], pages: { a: { ...a }, b: { ...b }, other: base({ id: 'other', dailyDate: '2026-10-20' }) } });
      history.clear('b');
    });

    it('turns the later page into an ordinary "(second copy)" without a date, and leaves the winner alone', () => {
      expect(resolveDailyDuplicates()).toBe(1);
      const pages = useNotes.getState().pages;
      expect(pages.a).toMatchObject({ dailyDate: '2026-10-19', title: 'Mon, 19 Oct 2026' });
      expect(pages.b).toMatchObject({ dailyDate: null, title: 'Mon, 19 Oct 2026 (second copy)' });
      expect(pages.other.dailyDate).toBe('2026-10-20');
    });

    it('does nothing the second time, and never stacks the suffix', () => {
      resolveDailyDuplicates();
      expect(resolveDailyDuplicates()).toBe(0);
      expect(useNotes.getState().pages.b.title).toBe('Mon, 19 Oct 2026 (second copy)');
    });

    it('also settles a page restored from the trash that clashes with the new day', () => {
      useNotes.setState((s) => {
        delete s.pages.b;
        s.trash = [{ ...b }];
      });
      restoreFromTrash('b');
      expect(useNotes.getState().pages.b.dailyDate).toBeNull();
      expect(dailyPageFor(useNotes.getState().pages, '2026-10-19')?.id).toBe('a');
    });
  });
});

describe('the same day made on both devices, through real sync', () => {
  let laptop: NotesStorage;
  let phone: NotesStorage;
  beforeEach(async () => {
    useDevice('laptop');
    laptop = await createTauriStorage();
    useDevice('phone');
    phone = await createTauriStorage();
  });
  const send = <T,>(req: SyncRequest) => {
    useDevice('laptop');
    return handleRequest(laptop.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
  };

  it('ends with both devices holding both pages and agreeing on which is the daily page', async () => {
    useDevice('laptop');
    await laptop.savePage(base({ id: 'L', title: 'Mon, 19 Oct 2026', dailyDate: '2026-10-19', created: 200, rev: 0 }));
    useDevice('phone');
    await phone.savePage(base({ id: 'P', title: 'Mon, 19 Oct 2026', dailyDate: '2026-10-19', created: 100, rev: 0 }));
    await syncWithLaptop(phone.sync, send);

    useDevice('laptop');
    const onLaptop = (await laptop.loadAll()).pages;
    useDevice('phone');
    const onPhone = (await phone.loadAll()).pages;
    expect(onLaptop.map((p) => p.id).sort()).toEqual(['L', 'P']);
    expect(onPhone.map((p) => p.id).sort()).toEqual(['L', 'P']);
    expect(findDailyDuplicates(onLaptop)).toEqual(findDailyDuplicates(onPhone));
    expect(findDailyDuplicates(onLaptop)[0].winner).toBe('P'); // created first
  });

  it('after the laptop fixes the loser, the phone receives the fix and no conflict copy appears', async () => {
    useDevice('laptop');
    await laptop.savePage(base({ id: 'L', title: 'Mon, 19 Oct 2026', dailyDate: '2026-10-19', created: 200, rev: 0 }));
    useDevice('phone');
    await phone.savePage(base({ id: 'P', title: 'Mon, 19 Oct 2026', dailyDate: '2026-10-19', created: 100, rev: 0 }));
    await syncWithLaptop(phone.sync, send);

    // The laptop settles it as an ordinary edit of the loser.
    useDevice('laptop');
    const loser = (await laptop.loadPage('L'))!;
    await laptop.savePage({ ...loser, dailyDate: null, title: 'Mon, 19 Oct 2026 (second copy)' });
    useDevice('phone');
    const r = await syncWithLaptop(phone.sync, send);
    expect(r.conflicts).toBe(0);
    useDevice('phone');
    const pages = (await phone.loadAll()).pages;
    expect(pages).toHaveLength(2);
    expect(pages.find((p) => p.id === 'L')).toMatchObject({ dailyDate: null, title: 'Mon, 19 Oct 2026 (second copy)' });
    expect(pages.find((p) => p.id === 'P')?.dailyDate).toBe('2026-10-19');
  });
});
