import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);
vi.mock('../src/lib/route', () => ({ navigate: () => {}, currentRoute: () => ({ name: 'library' }), useRoute: () => ({ name: 'library' }) }));
const toasts: string[] = [];
vi.mock('../src/store/ui', () => ({ toast: (m: string) => toasts.push(m), openMenu: () => {}, useUi: { getState: () => ({}), setState: () => {} }, dismissToastsOwnedBy: () => {} }));

import { createTauriStorage } from '../src/storage/tauri';
import { createWebStorage } from '../src/storage/web';
import type { NotesStorage } from '../src/storage/types';
import type { Group, Page } from '../src/types';
import { buildBackup, restoreBackup } from '../src/lib/backup';
import { splitGroups } from '../src/lib/workspaces';
import { createPage, flushAll, flushGroups, refreshFromDisk, setStorage, useNotes, createGroup } from '../src/store/notes';
import { copyPagesToWorkspace, createWorkspace, deleteWorkspace, movePagesToWorkspace, openPageAnywhere, renameWorkspace, switchWorkspace } from '../src/store/workspaces';
import { createCardFolder } from '../src/store/cardFolders';

const page = (id: string, extra: Partial<Page> = {}): Page => ({ id, title: id, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra });
const st = () => useNotes.getState();

describe.each([
  ['desktop', async () => (useDevice('d1'), createTauriStorage())],
  ['browser', async () => createWebStorage(`ws-${Math.random()}`).catch(() => null)],
])('workspaces in storage (%s)', (_n, make) => {
  let s: NotesStorage | null;
  beforeEach(async () => {
    s = await make();
  });

  it('stores a page and a group with their workspace, and reads them back', async () => {
    if (!s) return;
    await s.savePage(page('a', { workspace: 'w1' }));
    await s.savePage(page('b'));
    await s.saveGroups([{ id: 'w1', name: 'Student', color: 'teal', parentId: null, scope: 'workspaces' }, { id: 'g', name: 'Maths', color: 'plum', parentId: null, workspace: 'w1' }, { id: 'c', name: 'Cards', color: 'moss', parentId: null, scope: 'cards', workspace: 'w1' }]);
    const all = await s.loadAll();
    expect(all.pages.find((p) => p.id === 'a')!.workspace).toBe('w1');
    expect(all.pages.find((p) => p.id === 'b')!.workspace).toBeUndefined();
    const split = splitGroups(all.groups, 'w1');
    expect(split.workspaces.map((g) => g.name)).toEqual(['Student']);
    expect(split.groups.map((g) => g.id)).toEqual(['g']);
    expect(split.cardFolders.map((g) => g.id)).toEqual(['c']);
    // saved again unchanged: no new etag, so sync does not resend them
    const before = (await s.sync.listMeta('group')).map((m) => m.etag).join();
    await s.saveGroups(all.groups);
    expect((await s.sync.listMeta('group')).map((m) => m.etag).join()).toBe(before);
  });

  it('moves a page between workspaces on save, and the cheap reload sees only the open one (templates are in every one)', async () => {
    if (!s) return;
    await s.saveGroups([{ id: 'w1', name: 'Student', color: 'teal', parentId: null, scope: 'workspaces' }]);
    await s.savePage(page('a', { workspace: 'w1' }));
    await s.savePage(page('b'));
    await s.savePage(page('t', { kind: 'template' }));
    expect((await s.loadChanged({}, 'w1')).pages.map((p) => p.id).sort()).toEqual(['a', 't']);
    expect((await s.loadChanged({}, '')).pages.map((p) => p.id).sort()).toEqual(['b', 't']);
    expect((await s.loadChanged({}, null)).pages).toHaveLength(3);
    const a = (await s.loadPage('a'))!;
    await s.savePage({ ...a, workspace: undefined });
    expect((await s.loadPage('a'))!.workspace).toBeUndefined();
    expect((await s.outline()).find((o) => o.id === 'a')!.workspace).toBe('');
  });

  it('carries the workspace through sync and a backup', async () => {
    if (!s) return;
    await s.savePage(page('a', { workspace: 'w1' }));
    await s.saveGroups([{ id: 'w1', name: 'Student', color: 'teal', parentId: null, scope: 'workspaces' }, { id: 'g', name: 'Maths', color: 'plum', parentId: null, workspace: 'w1' }]);
    const recs = await s.sync.getRecords('page', ['a']);
    expect((recs[0] as { workspace?: string }).workspace).toBe('w1');
    const grecs = (await s.sync.getRecords('group', ['w1', 'g'])) as Group[];
    expect(grecs.find((g) => g.id === 'w1')!.scope).toBe('workspaces');
    expect(grecs.find((g) => g.id === 'g')!.workspace).toBe('w1');
    const backup = await buildBackup(s);
    const fresh = await make();
    if (!fresh) return;
    await restoreBackup(fresh, JSON.parse(JSON.stringify(backup)));
    expect((await fresh.loadPage('a'))!.workspace).toBe('w1');
    expect(splitGroups((await fresh.loadAll()).groups, 'w1').groups.map((g) => g.id)).toEqual(['g']);
  });
});

describe('a backup of one workspace', () => {
  it('holds that workspace whole, and restoring it elsewhere brings the workspace back (a page of an unknown workspace goes to Main)', async () => {
    useDevice('b1');
    const a = await createTauriStorage();
    await a.saveGroups([{ id: 'w1', name: 'Student', color: 'teal', parentId: null, scope: 'workspaces' }, { id: 'g1', name: 'Maths', color: 'plum', parentId: null, workspace: 'w1' }, { id: 'g0', name: 'Main group', color: 'plum', parentId: null }]);
    await a.savePage(page('s', { workspace: 'w1', groupId: 'g1' }));
    await a.savePage(page('m'));
    await a.savePage(page('t', { kind: 'template' }));
    const student = await buildBackup(a, 1, { workspace: 'w1' });
    expect(student.pages.map((p) => p.id)).toEqual(['s']);
    expect(student.groups.map((g) => g.id).sort()).toEqual(['g1', 'w1']);
    const main = await buildBackup(a, 1, { workspace: '' });
    expect(main.pages.map((p) => p.id).sort()).toEqual(['m', 't']);
    expect((await buildBackup(a)).pages).toHaveLength(3);

    useDevice('b2');
    const b = await createTauriStorage();
    await restoreBackup(b, JSON.parse(JSON.stringify(student)));
    expect((await b.loadPage('s'))!.workspace).toBe('w1');
    expect(splitGroups((await b.loadAll()).groups, 'w1').workspaces.map((g) => g.name)).toEqual(['Student']);

    useDevice('b3');
    const c = await createTauriStorage();
    const orphan = JSON.parse(JSON.stringify(student));
    orphan.groups = []; // the workspace's row is not in the file
    await restoreBackup(c, orphan);
    expect((await c.loadPage('s'))!.workspace).toBeUndefined();
  });
});

describe('the workspace actions', () => {
  let storage: NotesStorage;
  beforeEach(async () => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    toasts.length = 0;
    useDevice('d2');
    storage = await createTauriStorage();
    setStorage(storage);
    useNotes.setState({ status: 'ready', workspace: '', workspaces: [], mainName: 'Main', hiddenGroups: [], hiddenCardFolders: [], elsewhere: [], pages: {}, groups: [], cardFolders: [], trash: [], filter: { kind: 'all' } });
  });

  it('shows one workspace at a time and makes new pages in the open one', async () => {
    const a = createPage({ title: 'Main page' });
    const w = createWorkspace('Student');
    await flushGroups();
    await flushAll();
    expect(await switchWorkspace(w.id, { go: false })).toBe(true);
    expect(Object.keys(st().pages)).toEqual([]);
    expect(st().elsewhere.map((e) => e.id)).toEqual([a.id]);
    const b = createPage({ title: 'Essay' });
    expect(st().pages[b.id].workspace).toBe(w.id);
    await flushAll();
    await switchWorkspace('', { go: false });
    expect(Object.keys(st().pages)).toEqual([a.id]);
    expect(st().elsewhere.map((e) => e.id)).toEqual([b.id]);
  });

  it('never drops the groups of the workspace that is not open when groups are saved', async () => {
    const w = createWorkspace('Creator');
    createGroup('Ideas'); // Main
    await flushGroups();
    await switchWorkspace(w.id, { go: false });
    createGroup('Scripts');
    createCardFolder('Sponsors');
    await flushGroups();
    const names = (await storage.loadAll()).groups.map((g) => g.name).sort();
    expect(names).toEqual(['Creator', 'Ideas', 'Scripts', 'Sponsors']);
    expect(st().groups.map((g) => g.name)).toEqual(['Scripts']);
    await switchWorkspace('', { go: false });
    expect(st().groups.map((g) => g.name)).toEqual(['Ideas']);
    expect(st().cardFolders).toEqual([]);
  });

  it('moves pages to another workspace (out of their group) and can undo it', async () => {
    const w = createWorkspace('Student');
    const g = createGroup('Ideas');
    const p = createPage({ title: 'Plan', groupId: g.id });
    await flushGroups();
    await flushAll();
    expect(await movePagesToWorkspace([p.id], w.id)).toBe(1);
    expect(st().pages[p.id]).toBeUndefined();
    expect(st().elsewhere.find((e) => e.id === p.id)!.workspace).toBe(w.id);
    const stored = (await storage.loadPage(p.id))!;
    expect(stored.workspace).toBe(w.id);
    expect(stored.groupId).toBeNull();
    expect(toasts.at(-1)).toContain('Moved “Plan” to Student');
    expect(await movePagesToWorkspace([p.id], w.id)).toBe(0); // already there
  });

  it('refuses day pages and templates, and unknown workspaces', async () => {
    const w = createWorkspace('Student');
    const day = createPage({ title: 'Day', dailyDate: '2026-11-20' });
    const tpl = createPage({ title: 'T', kind: 'template' });
    await flushAll();
    expect(await movePagesToWorkspace([day.id, tpl.id], w.id)).toBe(0);
    expect(await movePagesToWorkspace([day.id], 'nope')).toBe(0);
    expect(await copyPagesToWorkspace([day.id], w.id)).toBe(0);
  });

  it('copies pages with new ids and leaves the original', async () => {
    const w = createWorkspace('Creator');
    const p = createPage({ title: 'Idea', tags: ['x'] });
    await flushAll();
    expect(await copyPagesToWorkspace([p.id], w.id)).toBe(1);
    expect(st().pages[p.id].title).toBe('Idea');
    const copy = st().elsewhere.find((e) => e.workspace === w.id)!;
    expect(copy.id).not.toBe(p.id);
    expect((await storage.loadPage(copy.id))!.tags).toEqual(['x']);
  });

  it('deletes a workspace by moving its pages and groups to Main', async () => {
    const w = createWorkspace('Temp');
    await switchWorkspace(w.id, { go: false });
    const g = createGroup('Stuff');
    const p = createPage({ title: 'In temp', groupId: g.id });
    await flushGroups();
    await flushAll();
    expect(await deleteWorkspace(w.id)).toBe(true);
    expect(st().workspace).toBe('');
    expect(st().workspaces).toEqual([]);
    expect(st().pages[p.id].title).toBe('In temp');
    expect(st().groups.map((x) => x.name)).toEqual(['Stuff']);
    expect((await storage.loadPage(p.id))!.workspace).toBeUndefined();
    expect(await deleteWorkspace('')).toBe(false);
  });

  it('opens a page that lives in another workspace by opening that workspace', async () => {
    const w = createWorkspace('Student');
    const p = createPage({ title: 'Plan' });
    await flushGroups();
    await flushAll();
    await movePagesToWorkspace([p.id], w.id, { quiet: true });
    expect(await openPageAnywhere('missing')).toBe(false);
    expect(await openPageAnywhere(p.id)).toBe(true);
    expect(st().workspace).toBe(w.id);
    expect(st().pages[p.id]).toBeDefined();
  });

  it('renames Main on this device and the others everywhere', async () => {
    const w = createWorkspace('Student');
    renameWorkspace('', 'Home');
    renameWorkspace(w.id, 'University');
    expect(st().mainName).toBe('Home');
    expect(st().workspaces[0].name).toBe('University');
    expect(await storage.getSetting('workspace.mainName')).toBe('Home');
    renameWorkspace(w.id, '   '); // an empty name is ignored
    expect(st().workspaces[0].name).toBe('University');
    await refreshFromDisk();
  });
});
