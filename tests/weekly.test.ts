import { describe, expect, it } from 'vitest';
import { buildWeekly, MAX_TASKS, MAX_TOUCHED, weekRange, weeklyBlocks } from '../src/lib/weekly';
import type { Block, ChecklistBlock, Page } from '../src/types';

const page = (id: string, extra: Partial<Page> = {}): Page => ({ id, title: id, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 1, ...extra });
const text = (id: string, html: string): Block => ({ id, type: 'note', style: 'text', x: 0, y: 0, w: 300, h: 60, z: 1, html }) as Block;
const list = (id: string, items: [string, boolean][], track?: ChecklistBlock['track']): ChecklistBlock =>
  ({ id, type: 'checklist', x: 0, y: 0, w: 300, h: 100, z: 1, items: items.map(([t, d], i) => ({ id: `${id}-${i}`, text: t, done: d })), ...(track ? { track } : {}) }) as ChecklistBlock;
const day = (date: string, blocks: Block[], extra: Partial<Page> = {}) => page('d' + date, { title: date, dailyDate: date, blocks, ...extra });
const byId = (...ps: Page[]) => Object.fromEntries(ps.map((p) => [p.id, p]));
const at = (date: string, h = 12) => new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h).getTime();

// Week of Mon 2 Nov 2026 to Sun 8 Nov 2026
const TODAY = '2026-11-05'; // a Thursday

describe('the week', () => {
  it('runs Monday to Sunday, from any day in it', () => {
    for (const d of ['2026-11-02', '2026-11-04', '2026-11-08']) expect(weekRange(d)).toMatchObject({ from: '2026-11-02', to: '2026-11-08' });
    expect(weekRange('2026-11-09').from).toBe('2026-11-09');
    expect(weekRange('2026-11-08').dates).toHaveLength(7);
  });
  it('crosses months and years', () => {
    expect(weekRange('2026-12-31')).toMatchObject({ from: '2026-12-28', to: '2027-01-03' });
    expect(weekRange('2024-03-01')).toMatchObject({ from: '2024-02-26', to: '2024-03-03' }); // a leap year
  });
});

describe('what happened', () => {
  it('lists the seven days with the first thing written, skipping the template’s own lines', () => {
    const pages = byId(day('2026-11-02', [text('a', '<p>Focus</p><p>Finish the report</p>')]), day('2026-11-03', [text('b', '<p>Focus</p>')]));
    const d = buildWeekly(pages, '2026-11-04', TODAY, new Set(['Focus']));
    expect(d.days.map((x) => x.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(d.days[0]).toMatchObject({ label: 'Mon, 2 Nov', hasPage: true, written: 'Finish the report' });
    expect(d.days[1]).toMatchObject({ hasPage: true, written: '' });
    expect(d.days[2]).toMatchObject({ hasPage: false, written: '' });
    expect(d.title).toBe('Week of Mon, 2 Nov 2026');
    expect(d.stats.daysWritten).toBe(1);
  });

  it('counts what was done and what is still open, once each, and a task done later is not open', () => {
    const pages = byId(
      day('2026-11-02', [list('l1', [['Email Sam', false], ['Book flights', false], ['  ', false]])]),
      day('2026-11-04', [list('l2', [['email sam', true], ['Water plants', false], ['Book flights', false]])]),
    );
    const d = buildWeekly(pages, TODAY, TODAY);
    expect(d.doneTasks).toEqual(['email sam']);
    expect(d.openTasks).toEqual(['Book flights', 'Water plants']);
    expect(d.stats).toMatchObject({ tasksDone: 1, tasksOpen: 2 });
  });

  it('does not count tasks from other weeks, from other pages, or from daily habit lists', () => {
    const habit = list('h', [['Run', true]], { start: '2026-11-02', day: TODAY, log: { '2026-11-05': ['h-0'] }, first: { 'h-0': '2026-11-02' } });
    const pages = byId(day('2026-10-28', [list('o', [['Last week', true]])]), day('2026-11-03', [habit]), page('plain', { blocks: [list('p', [['Not a daily page', false]])] }));
    const d = buildWeekly(pages, TODAY, TODAY);
    expect(d.doneTasks).toEqual([]);
    expect(d.openTasks).toEqual([]);
  });

  it('caps the lists', () => {
    const many = Array.from({ length: 50 }, (_, i) => [`task ${i}`, i % 2 === 0] as [string, boolean]);
    const d = buildWeekly(byId(day('2026-11-03', [list('l', many)])), TODAY, TODAY);
    expect(d.doneTasks).toHaveLength(MAX_TASKS);
    expect(d.openTasks).toHaveLength(MAX_TASKS);
    expect(d.stats.tasksDone).toBe(25); // the count is of everything, the list is capped
  });
});

describe('daily habits', () => {
  const t = (log: Record<string, string[]>, start = '2026-10-20'): ChecklistBlock['track'] => ({ start, day: TODAY, log, first: { 'h-0': start, 'h-1': start } });
  it('counts the days done this week out of the days that count, leaving today out until it is done and the future out entirely', () => {
    const habit = list('h', [['Run', false], ['Read', false]], t({ '2026-11-02': ['h-0'], '2026-11-03': ['h-0', 'h-1'], '2026-11-04': ['h-1'] }));
    const d = buildWeekly(byId(page('habits', { title: 'Habits', blocks: [habit] })), TODAY, TODAY);
    const run = d.habits.find((h) => h.text === 'Run')!, read = d.habits.find((h) => h.text === 'Read')!;
    expect(run).toMatchObject({ list: 'Habits', done: 2, counted: 3 }); // Mon, Tue, Wed counted; Wed missed; today (Thu) not over
    expect(read).toMatchObject({ done: 2, counted: 3 });
    expect(d.habits[0].done / d.habits[0].counted).toBeGreaterThanOrEqual(d.habits[1].done / d.habits[1].counted);
    const doneToday = list('h', [['Run', true]], t({ [TODAY]: ['h-0'] }));
    expect(buildWeekly(byId(page('x', { blocks: [doneToday] })), TODAY, TODAY).habits[0]).toMatchObject({ done: 1, counted: 4 });
  });
  it('does not count days before the item was added', () => {
    const habit = list('h', [['Run', false]], { start: '2026-11-04', day: TODAY, log: { '2026-11-04': ['h-0'] }, first: { 'h-0': '2026-11-04' } });
    expect(buildWeekly(byId(page('x', { blocks: [habit] })), TODAY, TODAY).habits[0]).toMatchObject({ done: 1, counted: 1 });
  });
  it('leaves out a habit that has not started yet', () => {
    const habit = list('h', [['Run', false]], { start: '2026-11-09', day: TODAY, log: {}, first: { 'h-0': '2026-11-09' } });
    expect(buildWeekly(byId(page('x', { blocks: [habit] })), TODAY, TODAY).habits).toEqual([]);
  });
});

describe('pages worked on', () => {
  it('lists pages edited this week, newest first, and not daily pages, templates, cards, attendance pages or other weeks', () => {
    const att = page('att', { title: 'Attendance: x', updated: at('2026-11-03'), blocks: [{ id: 'att-summary', type: 'table', x: 0, y: 0, w: 1, h: 1, z: 1, rows: [['a']], attendance: { pageId: 'p', blockId: 'b' } } as Block] });
    const pages = byId(
      page('old', { title: 'Old', updated: at('2026-10-30') }),
      page('mon', { title: 'Monday plan', updated: at('2026-11-02', 1) }),
      page('sun', { title: 'Sunday', updated: at('2026-11-08', 23) }),
      page('next', { title: 'Next week', updated: at('2026-11-09', 0) }),
      page('tpl', { title: 'Template', kind: 'template', updated: at('2026-11-03') }),
      page('card', { title: 'Card', kind: 'card', updated: at('2026-11-03') }),
      day('2026-11-03', [], { updated: at('2026-11-03') }),
      att,
      page('blank', { title: '', updated: at('2026-11-04') }),
    );
    const d = buildWeekly(pages, TODAY, TODAY);
    expect(d.touched.map((p) => p.title)).toEqual(['Sunday', 'Untitled', 'Monday plan']);
  });
  it('caps the list', () => {
    const pages = byId(...Array.from({ length: 30 }, (_, i) => page('p' + i, { title: 'P' + i, updated: at('2026-11-03', i % 20) })));
    expect(buildWeekly(pages, TODAY, TODAY).touched).toHaveLength(MAX_TOUCHED);
  });
});

describe('an empty week', () => {
  it('is empty when nothing happened, and not when anything did', () => {
    expect(buildWeekly({}, TODAY, TODAY).empty).toBe(true);
    expect(buildWeekly(byId(page('p', { updated: at('2026-11-03') })), TODAY, TODAY).empty).toBe(false);
  });
});

describe('the page it makes', () => {
  const rich = () =>
    buildWeekly(
      byId(
        day('2026-11-02', [text('a', '<p>Plan <b>& ship</b> the <report></p>'), list('l', [['Open <task>', false], ['Done & dusted', true]])]),
        page('habits', { title: 'Habits', blocks: [list('h', [['Run', false]], { start: '2026-11-02', day: TODAY, log: { '2026-11-02': ['h-0'] }, first: { 'h-0': '2026-11-02' } })] }),
        page('p1', { title: 'Trip [draft] <1>', updated: at('2026-11-03') }),
      ),
      TODAY, TODAY,
    );
  it('has a heading, the days, the lists, the habit table and the pages as links, all valid boxes', () => {
    const blocks = weeklyBlocks(rich());
    const types = blocks.map((b) => b.type);
    expect(types).toContain('checklist');
    expect(types).toContain('table');
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
    const all = blocks.filter((b) => (b.type === 'note' && b.style === 'text')).map((b) => (b as { html: string }).html).join('\n');
    expect(all).toContain('<h1>Week of Mon, 2 Nov 2026</h1>');
    expect(all).toContain('Mon, 2 Nov');
    expect(all).toContain('[[Trip draft &lt;1&gt;]]'); // brackets can't be in a link, and the markup is escaped
    expect(all).not.toMatch(/<report>|<task>/);
    const checks = blocks.filter((b): b is ChecklistBlock => b.type === 'checklist');
    expect(checks.some((c) => c.items.some((i) => i.text === 'Open <task>' && !i.done))).toBe(true);
    expect(checks.some((c) => c.items.some((i) => i.text === 'Done & dusted' && i.done))).toBe(true);
    const table = blocks.find((b) => b.type === 'table') as { rows: string[][] };
    expect(table.rows[0]).toEqual(['Habit', 'Done this week', 'Streak']);
    expect(table.rows[1][0]).toBe('Run');
  });
  it('fits on a portrait sheet, with nothing overlapping', () => {
    const blocks = weeklyBlocks(rich());
    for (const b of blocks) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1240);
    }
    for (let i = 0; i < blocks.length; i++)
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i], b = blocks[j];
        const o = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0;
        expect(o, `${a.type} and ${b.type} overlap`).toBe(false);
      }
  });
  it('still makes a sensible page for a week with only some of it', () => {
    const blocks = weeklyBlocks(buildWeekly(byId(day('2026-11-03', [text('a', '<p>Only this</p>')])), TODAY, TODAY));
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(blocks.filter((b) => (b.type === 'note' && b.style === 'text')).map((b) => (b as { html: string }).html).join(' ')).toContain('No to-do lists');
  });
});
