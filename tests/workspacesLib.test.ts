import { describe, expect, it } from 'vitest';
import { cleanWorkspaceId, cleanWorkspaceName, inWorkspace, isInScope, listWorkspaces, MAIN, resolveActive, scopeTo, splitGroups, stubsByWorkspace, uniqueName, workspaceOf } from '../src/lib/workspaces';
import { normalizePage } from '../src/storage/types';
import type { Group } from '../src/types';

const row = (id: string, name = id): Group => ({ id, name, color: 'teal', parentId: null, scope: 'workspaces' });

describe('workspace ids', () => {
  it('treat anything unsafe or missing as Main', () => {
    expect(cleanWorkspaceId(undefined)).toBe(MAIN);
    expect(cleanWorkspaceId('')).toBe(MAIN);
    expect(cleanWorkspaceId('../etc')).toBe(MAIN);
    expect(cleanWorkspaceId(42)).toBe(MAIN);
    expect(cleanWorkspaceId('abc-1_2')).toBe('abc-1_2');
    expect(workspaceOf({})).toBe(MAIN);
    expect(inWorkspace({ workspace: 'w1' }, 'w1')).toBe(true);
    expect(inWorkspace({}, 'w1')).toBe(false);
  });
  it('are kept on a page only when it is not Main, and cleaned on read', () => {
    expect(normalizePage({ id: 'a', workspace: 'w1' }).workspace).toBe('w1');
    expect('workspace' in normalizePage({ id: 'a' })).toBe(false);
    expect('workspace' in normalizePage({ id: 'a', workspace: '../x' })).toBe(false);
  });
});

describe('the list of workspaces', () => {
  it('always starts with Main, then the ones made in order', () => {
    const l = listWorkspaces([row('w1', 'Student'), { id: 'g', name: 'Not one', color: 'teal', parentId: null }, row('w2', 'Creator')], 'Home');
    expect(l.map((w) => [w.id, w.name])).toEqual([['', 'Home'], ['w1', 'Student'], ['w2', 'Creator']]);
    expect(listWorkspaces([]).map((w) => w.name)).toEqual(['Main']);
  });
  it('opens the remembered one only if it still exists', () => {
    const l = listWorkspaces([row('w1')]);
    expect(resolveActive('w1', l)).toBe('w1');
    expect(resolveActive('gone', l)).toBe(MAIN);
    expect(resolveActive(null, l)).toBe(MAIN);
  });
  it('gives a new workspace a name no other has', () => {
    expect(uniqueName('Student', ['Main'])).toBe('Student');
    expect(uniqueName('student', ['Student'])).toBe('student 2');
    expect(uniqueName('  ', [])).toBe('Workspace');
    expect(cleanWorkspaceName('  a   b ')).toBe('a b');
  });
});

describe('scoping', () => {
  const items = [{ id: 'a' }, { id: 'b', workspace: 'w1' }, { id: 't', kind: 'template', workspace: 'w1' }, { id: 'u', kind: 'template' }];
  it('keeps what belongs to the open workspace, and every template', () => {
    expect(scopeTo(items, '').map((x) => x.id)).toEqual(['a', 't', 'u']);
    expect(scopeTo(items, 'w1').map((x) => x.id)).toEqual(['b', 't', 'u']);
    expect(scopeTo(items, null)).toHaveLength(4);
    expect(isInScope({ workspace: 'w2' }, 'w1')).toBe(false);
  });
  it('splits the groups table into workspaces, this workspace and the rest, keeping all of them', () => {
    const all: Group[] = [row('w1'), { id: 'g1', name: 'Maths', color: 'teal', parentId: null }, { id: 'g2', name: 'Videos', color: 'teal', parentId: null, workspace: 'w1' }, { id: 'c1', name: 'F', color: 'teal', parentId: null, scope: 'cards', workspace: 'w1' }, { id: 'c2', name: 'G', color: 'teal', parentId: null, scope: 'cards' }];
    const main = splitGroups(all, '');
    expect(main.groups.map((g) => g.id)).toEqual(['g1']);
    expect(main.cardFolders.map((g) => g.id)).toEqual(['c2']);
    expect(main.hiddenGroups.map((g) => g.id)).toEqual(['g2']);
    expect(main.hiddenCardFolders.map((g) => g.id)).toEqual(['c1']);
    expect(main.workspaces.map((g) => g.id)).toEqual(['w1']);
    const w1 = splitGroups(all, 'w1');
    expect(w1.groups.map((g) => g.id)).toEqual(['g2']);
    expect(splitGroups(all, null).hiddenGroups).toEqual([]);
  });
  it('lists the pages of other workspaces for a picker, without templates or archived pages', () => {
    const stubs = [
      { id: 'a', title: 'Zed', kind: 'page', workspace: 'w1' },
      { id: 'b', title: 'Alpha', kind: 'card', workspace: 'w1' },
      { id: 'c', title: 'Old', kind: 'page', workspace: 'w1', archived: true },
      { id: 'd', title: 'T', kind: 'template', workspace: 'w1' },
      { id: 'e', title: 'Mine', kind: 'page', workspace: '' },
    ];
    const m = stubsByWorkspace(stubs, '');
    expect([...m.keys()]).toEqual(['w1']);
    expect(m.get('w1')!.map((s) => s.title)).toEqual(['Alpha', 'Zed']);
  });
});

import { resolveLink } from '../src/lib/boxLinks';

describe('a link to a page in another workspace', () => {
  const others = { stubs: [{ id: 'far', title: 'Thesis', kind: 'page', workspace: 'w1' }], nameOf: (id: string) => (id === 'w1' ? 'Student' : 'Main') };
  it('is not broken: it names the page and its workspace', () => {
    const r = resolveLink({ page: 'far' }, {}, others);
    expect(r.broken).toBeNull();
    expect(r.page).toBeNull();
    expect(r.label).toBe('Thesis · Student');
    expect(r.elsewhere?.workspace).toBe('w1');
  });
  it('is still broken when no workspace has the page, or when nothing is known about other workspaces', () => {
    expect(resolveLink({ page: 'gone' }, {}, others).broken).toBe('page');
    expect(resolveLink({ page: 'far' }, {}).broken).toBe('page');
  });
});

import { searchStubs, STARTERS, workspaceShortcut } from '../src/lib/workspaces';

describe('the extras', () => {
  const key = (code: string, extra = {}) => ({ code, ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, ...extra });
  it('Ctrl+Alt+digit picks a workspace by number, nothing else does', () => {
    expect(workspaceShortcut(key('Digit1'))).toBe(1);
    expect(workspaceShortcut(key('Digit9'))).toBe(9);
    expect(workspaceShortcut(key('Digit0'))).toBeNull();
    expect(workspaceShortcut(key('KeyD'))).toBeNull();
    expect(workspaceShortcut(key('Digit2', { altKey: false }))).toBeNull();
    expect(workspaceShortcut(key('Digit2', { shiftKey: true }))).toBeNull();
    expect(workspaceShortcut(key('Digit2', { repeat: true }))).toBeNull();
  });
  it('finds pages of other workspaces by every word of the title', () => {
    const stubs = [
      { id: 'a', title: 'Physics exam notes', kind: 'page', workspace: 'w1' },
      { id: 'b', title: 'Exam schedule', kind: 'page', workspace: 'w1' },
      { id: 'c', title: 'Exam template', kind: 'template', workspace: 'w1' },
      { id: 'd', title: 'Exam old', kind: 'page', workspace: 'w1', archived: true },
    ];
    expect(searchStubs(stubs, 'exam notes').map((s) => s.id)).toEqual(['a']);
    expect(searchStubs(stubs, 'EXAM').map((s) => s.id)).toEqual(['a', 'b']);
    expect(searchStubs(stubs, '   ')).toEqual([]);
    expect(searchStubs(stubs, 'exam', 1)).toHaveLength(1);
  });
  it('has starter groups, each with a few names', () => {
    expect(STARTERS.length).toBeGreaterThan(1);
    for (const s of STARTERS) expect(s.groups.length).toBeGreaterThan(1);
  });
});

import { todayEverywhere } from '../src/lib/todayAll';
import { findEverywhere } from '../src/lib/findAll';
import type { Page } from '../src/types';

const pg = (id: string, extra: Partial<Page> = {}): Page => ({ id, title: id, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra });
const note = (html: string) => ({ id: 'n' + html.length, type: 'note' as const, style: 'text' as const, x: 0, y: 0, w: 1, h: 1, z: 1, html });
const list = (id: string, items: [string, boolean][]) => ({ id, type: 'checklist' as const, x: 0, y: 0, w: 1, h: 1, z: 1, items: items.map(([text, done], i) => ({ id: `${id}${i}`, text, done })) });

describe('today, in every workspace', () => {
  const rows = [row('w1', 'Student')];
  const pages = [
    pg('d1', { title: 'Today', dailyDate: '2026-11-22', blocks: [note('<p>Read chapter 4</p>')] }),
    pg('a', { title: 'Plan', blocks: [list('l', [['Email tutor', false], ['Book room', true], ['  ', false]])], updated: 5 }),
    pg('s1', { title: 'Thesis', workspace: 'w1', blocks: [list('m', [['Draft intro', false]])], updated: 9 }),
    pg('s2', { title: 'Old', workspace: 'w1', archived: true, blocks: [list('o', [['Hidden', false]])] }),
    pg('t', { title: 'Tpl', kind: 'template', blocks: [list('p', [['From template', false]])] }),
  ];
  const [main, student] = todayEverywhere(pages, rows, 'Main', '2026-11-22');
  it('gives each workspace its own journal page, open to-dos and latest pages', () => {
    expect(main.workspace.name).toBe('Main');
    expect(main.journal).toEqual({ pageId: 'd1', snippet: 'Read chapter 4' });
    expect(main.todos.map((t) => t.text)).toEqual(['Email tutor']);
    expect(main.recent.map((r) => r.title)).toEqual(['Plan']);
    expect(student.journal).toBeNull();
    expect(student.todos.map((t) => t.text)).toEqual(['Draft intro']);
  });
  it('leaves out done items, blanks, archived pages and templates, and counts what it cuts', () => {
    expect(main.todoCount).toBe(1);
    const many = [pg('x', { blocks: [list('z', Array.from({ length: 12 }, (_, i) => [`item ${i}`, false] as [string, boolean]))] })];
    const [m] = todayEverywhere(many, [], 'Main', '2026-11-22');
    expect(m.todos).toHaveLength(8);
    expect(m.todoCount).toBe(12);
  });
});

describe('find in every workspace', () => {
  const pages = [
    pg('a', { title: 'Physics', blocks: [note('<p>Newton wrote the Principia</p>')], updated: 1 }),
    pg('b', { title: 'Newton notes', workspace: 'w1', updated: 2 }),
    pg('c', { title: 'Old newton', workspace: 'w1', archived: true }),
    pg('d', { title: 'Newton template', kind: 'template' }),
  ];
  it('searches titles and text in all workspaces, titles first, with a snippet', () => {
    const r = findEverywhere(pages, 'newton');
    expect(r.map((x) => x.pageId)).toEqual(['b', 'a']);
    expect(r[0].workspace).toBe('w1');
    expect(r[1].snippet).toContain('Newton wrote');
    expect(findEverywhere(pages, 'newton principia').map((x) => x.pageId)).toEqual(['a']);
    expect(findEverywhere(pages, '  ')).toEqual([]);
  });
});

import { adopt, recentStubs } from '../src/lib/workspaces';

describe('orphans and recents', () => {
  it('sends the pages and groups of a workspace that no longer exists to Main, and leaves the rest alone', () => {
    const out = adopt([{ id: 'a', workspace: 'gone' }, { id: 'b', workspace: 'w1' }, { id: 'c' }, { id: 'w1', scope: 'workspaces', workspace: 'gone' }], [{ id: 'w1' }]);
    expect(out.map((x) => workspaceOf(x))).toEqual(['', 'w1', '', 'gone']); // a workspace row itself is never rewritten
    expect('workspace' in out[0]).toBe(false);
  });
  it('lists the latest edited pages of other workspaces, newest first, without templates and archived pages', () => {
    const stubs = [
      { id: 'a', title: 'A', kind: 'page', workspace: 'w', updated: 5 },
      { id: 'b', title: 'B', kind: 'page', workspace: 'w', updated: 9 },
      { id: 'c', title: 'C', kind: 'template', workspace: 'w', updated: 99 },
      { id: 'd', title: 'D', kind: 'page', workspace: 'w', updated: 50, archived: true },
      { id: 'e', title: 'E', kind: 'page', workspace: 'w' },
    ];
    expect(recentStubs(stubs).map((s) => s.id)).toEqual(['b', 'a']);
    expect(recentStubs(stubs, 1)).toHaveLength(1);
  });
});
