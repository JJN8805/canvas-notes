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
