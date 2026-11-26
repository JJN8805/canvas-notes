import { describe, expect, it } from 'vitest';
import { addedItemId, applyAdd, applyToggle, buildSnapshot, parseActions } from '../src/lib/homeWidgets';
import { dateKey } from '../src/lib/daily';
import type { Block, Page } from '../src/types';

const list = (id: string, items: [string, string, boolean][], extra: object = {}): Block => ({ id, type: 'checklist', x: 0, y: 0, w: 200, h: 50, z: 1, items: items.map(([i, text, done]) => ({ id: i, text, done })), ...extra }) as Block;
const page = (id: string, title: string, blocks: Block[], extra: Partial<Page> = {}): Page => ({ id, title, groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 1, sheet: null, ...extra });
const at = Date.now();
const today = dateKey();
let n = 0;
const mk = () => 'new' + ++n;

describe('what the widgets show', () => {
  const pages = [
    page('p1', 'Shopping', [list('c1', [['a', 'Milk', false], ['b', 'Eggs', true], ['e', '   ', false]])], { updated: 5 }),
    page('p2', 'Work', [list('c2', [['c', 'Report', false]]), list('c3', [])], { updated: 9, workspace: 'w1' }),
    page('p3', 'Old', [list('c4', [['d', 'Gone', false]])], { archived: true }),
    page('t', 'Template', [list('c5', [['f', 'x', false]])], { kind: 'template' }),
  ];
  const s = buildSnapshot(pages, new Map([['', 'Main'], ['w1', 'Study']]));
  it('puts every open to-do in one list, newest page first, leaving out archived pages, templates and blank lines', () => {
    expect(s.lists[0]).toMatchObject({ id: 'today', items: [{ ref: 'p2|c2|c', text: 'Report', from: 'Work · Study' }, { ref: 'p1|c1|a', text: 'Milk', from: 'Shopping · Main' }] });
  });
  it('lists each checklist, numbering a page that has several', () => {
    expect(s.lists.slice(1).map((l) => l.title)).toEqual(['Work · Study (1)', 'Work · Study (2)', 'Shopping · Main']);
    expect(s.lists.find((l) => l.id === 'p1|c1')!.items).toHaveLength(2);
  });
  it('gives the words of pages', () => {
    expect(s.pages.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(s.pages[1].text).toContain('Milk');
  });
});

describe('what comes back from a widget is checked', () => {
  it('keeps good actions and rejects the rest', () => {
    const raw = JSON.stringify([
      { id: 'a1', at: 1, type: 'toggle', ref: 'p|b|i', done: true },
      { id: 'a2', type: 'add', list: 'today', text: ' two\nlines ' },
      { id: 'a3', type: 'capture', text: 'note' },
      { id: 'a4', type: 'open', page: 'p1' },
      { id: 'a5', type: 'add', list: '../x|y', text: 'bad list' },
      { id: 'a6', type: 'toggle', ref: 'p|b|<i>', done: true },
      { id: 'a7', type: 'open', page: 'javascript:alert(1)' },
      { id: 'a8', type: 'delete', page: 'p1' },
      { id: '../../etc', type: 'capture', text: 'x' },
      { id: 'a9', type: 'capture', text: '   ' },
      null,
    ]);
    const r = parseActions(raw);
    expect(r.actions.map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(r.actions[1]).toMatchObject({ text: 'two lines' });
    expect(r.rejected).toEqual(['a5', 'a6', 'a7', 'a8', 'a9']);
  });
  it('survives garbage', () => {
    for (const bad of ['', 'not json', '{}', 'null', 12]) expect(parseActions(bad).actions).toEqual([]);
  });
});

describe('applying a tick', () => {
  const toggle = (itemId: string, done: boolean, when = at) => ({ id: 'x', at: when, type: 'toggle' as const, itemId, done });
  const p = page('p1', 'S', [list('c1', [['a', 'Milk', false]])]);
  it('ticks the item wherever it is, and does nothing the second time or for a missing item', () => {
    const next = applyToggle([p], toggle('a', true), today)!;
    expect((next.blocks[0] as Extract<Block, { type: 'checklist' }>).items[0].done).toBe(true);
    expect(applyToggle([next], toggle('a', true), today)).toBeNull();
    expect(applyToggle([p], toggle('zzz', true), today)).toBeNull();
  });
  it("does not count yesterday's tick on a daily-tracked list", () => {
    const daily = page('p2', 'Habits', [list('c1', [['a', 'Run', false]], { track: { start: today, day: today, log: {}, first: {} } })]);
    expect(applyToggle([daily], toggle('a', true, at - 3 * 86400000), today)).toBeNull();
    expect(applyToggle([daily], toggle('a', true), today)).not.toBeNull();
  });
});

describe('applying a new to-do', () => {
  const add = (listId: string, id = 'abc-def') => ({ id, at, type: 'add' as const, list: listId, text: 'Bread' });
  const p = page('p1', 'S', [list('c1', [['a', 'Milk', false]])]);
  const items = (pg: Page, k = 0) => (pg.blocks[k] as Extract<Block, { type: 'checklist' }>).items;
  it('adds to its list once, with the id the widget already showed', () => {
    const r = applyAdd([p], add('p1|c1'), '', mk)!;
    expect(items(r.page).map((i) => [i.id, i.text])).toEqual([['a', 'Milk'], [addedItemId('abc-def'), 'Bread']]);
    expect(applyAdd([r.page], add('p1|c1'), '', mk)).toBeNull();
  });
  it('makes an Inbox for the combined list or a list that is gone, then keeps using it', () => {
    const first = applyAdd([p], add('today', 'one'), 'w1', mk)!;
    expect(first.created).toBe(true);
    expect(first.page).toMatchObject({ title: 'Inbox', workspace: 'w1' });
    const second = applyAdd([p, first.page], add('gone|gone', 'two'), 'w1', mk)!;
    expect(second.created).toBe(false);
    expect(second.page.id).toBe(first.page.id);
    expect(items(second.page)).toHaveLength(2);
  });
  it('adds a list to an Inbox that only has notes', () => {
    const inbox = page('in', 'Inbox', [{ id: 'n', type: 'note', style: 'text', x: 40, y: 40, w: 200, h: 100, z: 1, html: '<p>hi</p>' } as Block]);
    const r = applyAdd([inbox], add('today'), '', mk)!;
    expect(r.page.blocks).toHaveLength(2);
    expect(r.page.blocks[1].y).toBeGreaterThan(140);
  });
});
