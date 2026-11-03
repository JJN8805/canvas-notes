import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { attendanceBlocks, attendanceLink, dayLevel, dayShare, itemStats, reconcile, rollover, startTracking, withAttendance } from '../src/lib/attendance';
import { createPage, duplicateBlocks, ensureAttendancePage, findAttendancePage, refreshAttendance, rolloverTracked, setHeatmapWriter, setTracking, undo, updateBlock, useNotes } from '../src/store/notes';
import { addDays as addDaysKey } from '../src/lib/daily';
import { fingerprint, heatmapSvg, heatWindow, mondayOf, MAX_WEEKS } from '../src/lib/heatmap';
import { cloneContent } from '../src/lib/pages';
import type { Block, ChecklistBlock, ImageBlock, Page, TableBlock } from '../src/types';

const list = (): ChecklistBlock => ({
  id: 'L', type: 'checklist', x: 0, y: 0, w: 300, h: 48, z: 1,
  items: [{ id: 'read', text: 'Read a book', done: false }, { id: 'ex', text: 'Exercise', done: false }, { id: 'blank', text: '', done: false }],
});
const tick = (b: ChecklistBlock, ...ids: string[]) => b.items.forEach((i) => (i.done = ids.includes(i.id)));

describe('recording a tracked list', () => {
  it('starts with today, remembering what is already ticked and ignoring blank items', () => {
    const b = list();
    tick(b, 'read');
    b.track = startTracking(b, '2026-10-20');
    expect(b.track).toEqual({ start: '2026-10-20', day: '2026-10-20', log: { '2026-10-20': ['read'] }, first: { read: '2026-10-20', ex: '2026-10-20' } });
  });

  it('keeps the day in line with the checks, and drops the day when nothing is ticked', () => {
    const b = list();
    b.track = startTracking(b, '2026-10-20');
    tick(b, 'read', 'ex');
    expect(reconcile(b)).toBe(true);
    expect(b.track.log['2026-10-20']).toEqual(['read', 'ex']);
    expect(reconcile(b)).toBe(false);
    tick(b);
    reconcile(b);
    expect(b.track.log).toEqual({});
  });

  it('clears the checks on a new day and keeps yesterday’s record', () => {
    const b = list();
    b.track = startTracking(b, '2026-10-20');
    tick(b, 'read');
    reconcile(b);
    expect(rollover(b, '2026-10-20')).toBe(false);
    expect(rollover(b, '2026-10-21')).toBe(true);
    expect(b.items.every((i) => !i.done)).toBe(true);
    expect(b.track.day).toBe('2026-10-21');
    expect(b.track.log['2026-10-20']).toEqual(['read']);
    reconcile(b);
    expect(b.track.log['2026-10-21']).toBeUndefined();
  });

  it('gives an item added later its own start, so earlier days are not held against it', () => {
    const b = list();
    b.track = startTracking(b, '2026-10-20');
    rollover(b, '2026-10-23');
    b.items.push({ id: 'new', text: 'Stretch', done: false });
    reconcile(b);
    expect(b.track.first.new).toBe('2026-10-23');
  });
});

describe('attendance numbers', () => {
  // read: done 20, 21, (missed 22), done 23 and today (24). exercise: done 20 only.
  const make = () => {
    const b = list();
    b.track = { start: '2026-10-20', day: '2026-10-24', first: { read: '2026-10-20', ex: '2026-10-20' }, log: { '2026-10-20': ['read', 'ex'], '2026-10-21': ['read'], '2026-10-23': ['read'], '2026-10-24': ['read'] } };
    return b;
  };

  it('counts done days, rates and streaks, treating a day with nothing ticked as missed', () => {
    const [read, ex] = itemStats(make(), '2026-10-24');
    expect(read).toMatchObject({ text: 'Read a book', done: 4, tracked: 5, rate: 80, streak: 2, best: 2 });
    expect(ex).toMatchObject({ done: 1, tracked: 4, rate: 25, streak: 0, best: 1 });
  });

  it('does not count today as missed until it is over, and keeps yesterday’s streak alive', () => {
    const b = make();
    b.track!.log['2026-10-24'] = [];
    delete b.track!.log['2026-10-24'];
    const [read] = itemStats(b, '2026-10-24');
    expect(read).toMatchObject({ done: 3, tracked: 4, streak: 1 });
    const [, ex] = itemStats(b, '2026-10-24');
    expect(ex.streak).toBe(0);
  });

  it('works out how much of the list was done each day, counting only items already on it', () => {
    const b = make(); // read: 20,21,23,24 · exercise: 20
    const share = (d: string) => dayShare(b, d, '2026-10-24');
    expect(share('2026-10-19')).toBeNull(); // before tracking
    expect(share('2026-10-20')).toBe(1);
    expect(share('2026-10-21')).toBe(0.5);
    expect(share('2026-10-22')).toBe(0);
    expect(share('2026-10-25')).toBeNull(); // still to come
    b.items.push({ id: 'c', text: 'Third', done: false });
    b.track!.first.c = '2026-10-23';
    expect(share('2026-10-21')).toBe(0.5); // the new item didn't exist yet
    expect(share('2026-10-23')).toBeCloseTo(1 / 3);
    expect(dayShare(b, '2026-10-22', '2026-10-24', 'read')).toBe(0);
    expect(dayShare(b, '2026-10-23', '2026-10-24', 'c')).toBe(0);
  });

  it('turns that into GitHub-style levels: shades for done, grey for missed, an outline for today until done', () => {
    const b = make();
    const lvl = (d: string, only?: string) => dayLevel(b, d, '2026-10-24', only);
    expect(lvl('2026-10-19')).toBe(-1);
    expect(lvl('2026-10-25')).toBe(-3);
    expect(lvl('2026-10-20')).toBe(4);
    expect(lvl('2026-10-21')).toBe(2);
    expect(lvl('2026-10-22')).toBe(0);
    expect(lvl('2026-10-21', 'read')).toBe(4);
    delete b.track!.log['2026-10-24'];
    expect(lvl('2026-10-24')).toBe(-2);
    b.track!.log['2026-10-24'] = ['read'];
    b.items.push({ id: 'c', text: 'C', done: false }, { id: 'd', text: 'D', done: false });
    b.track!.first.c = b.track!.first.d = '2026-10-20';
    expect(lvl('2026-10-24')).toBe(1); // one of four still shows a little green
  });

});

describe('the attendance page content', () => {
  it('has a title, a summary linked to its list, and a table per month', () => {
    const b = make2();
    const { blocks, svgs } = attendanceBlocks(b, { pageId: 'P', blockId: 'L' }, 'Daily habits', '2026-10-24');
    expect(blocks.map((x) => x.id)).toEqual(['att-title', 'att-hm-all', 'att-summary', 'att-hm-read', 'att-hm-ex']);
    expect((blocks[0] as { html: string }).html).toContain('Attendance: Daily habits');
    const summary = blocks.find((x) => x.id === 'att-summary') as TableBlock;
    expect(summary.attendance).toEqual({ pageId: 'P', blockId: 'L' });
    expect(summary.rows[1]).toEqual(['Read a book', '1', '1', '100%', '1', '1']);
    expect(new Set(blocks.map((x) => x.z)).size).toBe(blocks.length);
    // a heatmap picture per list and item, each remembering what it was drawn from
    expect(Object.keys(svgs)).toEqual(['att-hm-all', 'att-hm-read', 'att-hm-ex']);
    for (const [id, svg] of Object.entries(svgs)) {
      const img = blocks.find((x) => x.id === id) as ImageBlock;
      expect(img).toMatchObject({ type: 'image', imageId: '', heat: fingerprint(svg) });
      expect(img.h).toBe(Math.round(img.w / img.aspect));
    }
  });

  it('rewrites only its own blocks, keeping the user’s and their layout changes, and says when nothing changed', () => {
    const b = make2();
    const withIds = (c: ReturnType<typeof attendanceBlocks>) => c.blocks.map((x) => (x.type === 'image' ? { ...x, imageId: 'pic-' + x.heat } : x));
    const gen = withIds(attendanceBlocks(b, { pageId: 'P', blockId: 'L' }, 'T', '2026-10-24'));
    const mine: Block = { id: 'note', type: 'text', x: 5, y: 5, w: 100, h: 40, z: 9, html: '<p>mine</p>' };
    const moved = gen.map((g) => (g.id === 'att-summary' ? { ...g, x: 900 } : g));
    expect(withAttendance([mine, ...moved], gen)).toBeNull();
    b.track!.log['2026-10-24'] = ['read', 'ex'];
    const next = withAttendance([mine, ...moved], withIds(attendanceBlocks(b, { pageId: 'P', blockId: 'L' }, 'T', '2026-10-24')))!;
    expect(next.find((x) => x.id === 'note')).toBe(mine);
    const summary = next.find((x) => x.id === 'att-summary') as TableBlock;
    expect(summary.x).toBe(900);
    expect(summary.rows[2][1]).toBe('1');
    expect(next.filter((x) => x.id.startsWith('att-'))).toHaveLength(gen.length);
  });

  function make2() {
    const b = list();
    b.track = { start: '2026-10-24', day: '2026-10-24', first: { read: '2026-10-24', ex: '2026-10-24' }, log: { '2026-10-24': ['read'] } };
    return b;
  }
});

describe('in the notes store', () => {
  const stored: string[] = [];
  const settle = () => vi.advanceTimersByTimeAsync(600);
  const T = (d: string) => new Date(`${d}T09:00:00`).getTime();
  const blockOf = (id: string, bid = 'L') => useNotes.getState().pages[id].blocks.find((b) => b.id === bid) as ChecklistBlock;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(T('2026-10-20'));
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useNotes.setState({ filter: { kind: 'all' }, pages: {} });
    stored.length = 0;
    setHeatmapWriter(async (svg) => {
      stored.push(svg);
      return 'img-' + stored.length;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const makePage = (): Page => createPage({ title: 'Habits', blocks: [list()] });
  const check = (pid: string, ...ids: string[]) => updateBlock<ChecklistBlock>(pid, 'L', (b) => tick(b as ChecklistBlock, ...ids));

  it('records each check as it is made, and undo takes it back', () => {
    const p = makePage();
    setTracking(p.id, 'L', true);
    check(p.id, 'read');
    expect(blockOf(p.id).track!.log).toEqual({ '2026-10-20': ['read'] });
    undo(p.id);
    expect(blockOf(p.id).track!.log).toEqual({});
    expect(blockOf(p.id).items[0].done).toBe(false);
  });

  it('starts a new day unchecked once the page is opened, keeping the record', () => {
    const p = makePage();
    setTracking(p.id, 'L', true);
    check(p.id, 'read', 'ex');
    expect(rolloverTracked(p.id)).toBe(false);
    vi.setSystemTime(T('2026-10-21'));
    expect(rolloverTracked(p.id)).toBe(true);
    expect(blockOf(p.id).items.every((i) => !i.done)).toBe(true);
    expect(blockOf(p.id).track!.log['2026-10-20']).toEqual(['read', 'ex']);
    expect(rolloverTracked(p.id)).toBe(false);
  });

  const imagesOf = (id: string) => useNotes.getState().pages[id].blocks.filter((b): b is ImageBlock => b.type === 'image');

  it('makes one attendance page per list, links it back, and keeps it current', async () => {
    const p = makePage();
    setTracking(p.id, 'L', true);
    check(p.id, 'read');
    const id = ensureAttendancePage(p.id, 'L')!;
    await settle();
    const att = useNotes.getState().pages[id];
    expect(att.title).toBe('Attendance: Habits');
    expect(attendanceLink(att)).toEqual({ pageId: p.id, blockId: 'L' });
    expect(ensureAttendancePage(p.id, 'L')).toBe(id);
    expect(findAttendancePage(p.id, 'L')?.id).toBe(id);
    // a heatmap picture for the list and one per item, each stored once
    expect(imagesOf(id).map((b) => b.id).sort()).toEqual(['att-hm-all', 'att-hm-ex', 'att-hm-read']);
    expect(imagesOf(id).every((b) => b.imageId.startsWith('img-'))).toBe(true);
    expect(stored).toHaveLength(3);
    await refreshAttendance(id);
    expect(stored).toHaveLength(3); // nothing changed, so nothing is drawn or stored again

    vi.setSystemTime(T('2026-10-21'));
    rolloverTracked(p.id);
    check(p.id, 'read', 'ex');
    await settle(); // the update follows the last change a moment later
    const summary = useNotes.getState().pages[id].blocks.find((b) => b.id === 'att-summary') as TableBlock;
    expect(summary.rows[1]).toEqual(['Read a book', '2', '2', '100%', '2', '2']);
    expect(summary.rows[2]).toEqual(['Exercise', '1', '2', '50%', '1', '1']);
    expect(stored.length).toBeGreaterThan(3); // the pictures changed, so new ones were stored

    // days passing with nothing ticked show up as missed when the attendance page is opened
    vi.setSystemTime(T('2026-10-24'));
    await refreshAttendance(id);
    const again = useNotes.getState().pages[id].blocks.find((b) => b.id === 'att-summary') as TableBlock;
    expect(again.rows[1]).toEqual(['Read a book', '2', '4', '50%', '0', '2']);
  });

  it('only redraws the pictures that changed', async () => {
    const p = makePage();
    setTracking(p.id, 'L', true);
    const id = ensureAttendancePage(p.id, 'L')!;
    await settle();
    const before = Object.fromEntries(imagesOf(id).map((b) => [b.id, b.imageId]));
    check(p.id, 'read'); // only "Read a book" and the whole list change
    await settle();
    const after = Object.fromEntries(imagesOf(id).map((b) => [b.id, b.imageId]));
    expect(after['att-hm-ex']).toBe(before['att-hm-ex']);
    expect(after['att-hm-read']).not.toBe(before['att-hm-read']);
    expect(after['att-hm-all']).not.toBe(before['att-hm-all']);
  });

  it('does not make an attendance page for a list that is not tracked', () => {
    const p = makePage();
    expect(ensureAttendancePage(p.id, 'L')).toBeNull();
  });

  it('stops tracking by forgetting the record', () => {
    const p = makePage();
    setTracking(p.id, 'L', true);
    setTracking(p.id, 'L', false);
    expect(blockOf(p.id).track).toBeUndefined();
  });

  it('gives copies of a tracked list no history', () => {
    const p = makePage();
    setTracking(p.id, 'L', true);
    check(p.id, 'read');
    const [copyId] = duplicateBlocks(p.id, ['L']);
    expect(blockOf(p.id, copyId).track).toBeUndefined();
    const cloned = cloneContent(useNotes.getState().pages[p.id]);
    expect(cloned.blocks.every((b) => b.type !== 'checklist' || !b.track)).toBe(true);
    expect(blockOf(p.id).track).toBeDefined();
  });
});

describe('the attendance page layout', () => {
  const lay = (weeks: number) => {
    const b = list();
    const today = '2026-10-24';
    b.items.push({ id: 'med', text: 'Meditate for ten minutes', done: false });
    b.track = startTracking(b, weeks ? addDaysKey(today, -weeks * 7) : today);
    const { blocks } = attendanceBlocks(b, { pageId: 'P', blockId: 'L' }, 'Habits', today);
    return blocks;
  };
  const box = (b: Block) => ({ x: b.x, y: b.y, w: b.w, h: b.type === 'table' ? b.rows.length * 52 + 24 : b.h });
  const overlaps = (a: Block, c: Block) => {
    const p = box(a), q = box(c);
    return p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  };

  it.each([0, 4, 20, 60])('never lets two boxes overlap, however long it has been tracked (%i weeks)', (weeks) => {
    const blocks = lay(weeks);
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) expect(overlaps(blocks[i], blocks[j]), `${blocks[i].id} / ${blocks[j].id}`).toBe(false);
  });

  it('puts the summary under the whole-list heatmap', () => {
    const at = (blocks: Block[], id: string) => blocks.find((x) => x.id === id)!;
    // The calendar is always a full year wide, so the summary always sits under it.
    for (const weeks of [4, 60]) {
      const blocks = lay(weeks);
      expect(at(blocks, 'att-summary').x).toBe(at(blocks, 'att-hm-all').x);
      expect(at(blocks, 'att-summary').y).toBeGreaterThan(at(blocks, 'att-hm-all').y + at(blocks, 'att-hm-all').h);
    }
  });

  it('wraps the per-item heatmaps onto a new row instead of running off the page', () => {
    const blocks = lay(60);
    const items = blocks.filter((b) => b.id.startsWith('att-hm-') && b.id !== 'att-hm-all');
    expect(items.length).toBe(3);
    expect(new Set(items.map((b) => b.y)).size).toBeGreaterThan(1);
    for (const b of items) expect(b.x + b.w).toBeLessThanOrEqual(1700 + 1);
  });
});

describe('the heatmap drawing', () => {
  it('always spans a full year, ending with this week', () => {
    expect(mondayOf('2026-10-24')).toBe('2026-10-19'); // a Saturday
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    for (const track of ['2026-10-24', '2026-06-01', '2020-01-01']) {
      const w = heatWindow(track, '2026-10-24');
      expect(w.weeks).toBe(MAX_WEEKS);
      expect(addEnd(w)).toBe('2026-10-19');
    }
  });

  it('draws a cell per counted day with the right colours, and nothing for days that do not count', () => {
    const { svg, width, height } = heatmapSvg({
      start: '2026-10-19',
      weeks: 2,
      legend: 'share',
      levelOf: (k) => ({ '2026-10-19': 4, '2026-10-20': 1, '2026-10-21': 0, '2026-10-22': -2, '2026-10-23': -1 })[k] as never ?? -3,
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`width="${width}" height="${height}"`);
    expect(svg).toContain('#216e39'); // level 4
    expect(svg).toContain('#9be9a8'); // level 1
    expect(svg).toContain('fill-opacity="0.28"'); // a missed day
    expect(svg).toContain('fill="none"'); // today's outline
    expect(svg).toContain('Oct');
    expect(svg).toContain('Mon');
    expect(svg).toContain('fill-opacity="0.12"'); // an untracked day, drawn faintly
    // 5 day cells + 5 legend cells
    expect(svg.match(/<rect /g)).toHaveLength(10);
  });

  it('draws a title above the grid when given one, and escapes it', () => {
    const plain = heatmapSvg({ start: '2026-10-19', weeks: 12, legend: 'single', levelOf: () => -1 });
    const titled = heatmapSvg({ start: '2026-10-19', weeks: 12, legend: 'single', title: 'Read <b> & write', levelOf: () => -1 });
    expect(titled.height).toBeGreaterThan(plain.height);
    expect(titled.svg).toContain('Read &lt;b> &amp; write');
    expect(plain.svg).not.toContain('font-weight="600"');
  });

  it('names the same drawing the same way, and a different one differently', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
  });
});

const addEnd = (w: { start: string; weeks: number }) => {
  const d = new Date(w.start + 'T12:00:00');
  d.setDate(d.getDate() + (w.weeks - 1) * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
