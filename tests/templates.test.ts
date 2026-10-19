import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { normalizePage, type NotesStorage, type PageRecord } from '../src/storage/types';
import { cleanDate, cloneContent, isTemplate, kindOf, libraryPages, templateFrom, templatesOf } from '../src/lib/pages';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import { history } from '../src/store/history';
import { duplicatePage, useNotes } from '../src/store/notes';
import type { Block, Page } from '../src/types';

const text = (id: string, extra: Partial<Block> = {}) => ({ id, type: 'text', x: 0, y: 0, w: 200, h: 40, z: 1, html: '<p>zebra</p>', ...extra }) as Block;
const page = (extra: Partial<Page> = {}): Page => ({ id: 'p', title: 'Page', groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra });
const rich = (): Page =>
  page({
    id: 'src',
    title: 'Weekly',
    groupId: 'g',
    tags: ['work'],
    dailyDate: '2026-10-19',
    color: 'blue',
    drawing: { scene: '{"elements":[]}', preview: '<svg/>', x: 0, y: 0, w: 10, h: 10 },
    blocks: [
      { id: 'f', type: 'frame', x: 0, y: 0, w: 400, h: 300, z: 0, title: 'Goals', color: 'teal', collapsed: false } as Block,
      text('a', { frameId: 'f' }),
      { id: 'c', type: 'checklist', x: 0, y: 0, w: 100, h: 40, z: 2, items: [{ id: 'i1', text: 'one', done: false }, { id: 'i2', text: 'two', done: true }], frameId: 'f' } as Block,
      { id: 's', type: 'sticky', x: 0, y: 0, w: 200, h: 200, z: 3, html: '', tint: 'yellow' } as Block,
    ],
    arrows: [
      { id: 'ar1', from: 'a', to: 's', heads: 'one', style: 'solid', z: 1 },
      { id: 'ar2', from: 'a', to: 'ghost', heads: 'one', style: 'solid', z: 2 },
    ],
  });

describe('template selectors', () => {
  it('tell templates from pages, and treat anything else as a page', () => {
    expect(kindOf({})).toBe('page');
    expect(kindOf({ kind: 'template' })).toBe('template');
    expect(kindOf({ kind: 'banana' })).toBe('page');
    expect(isTemplate(page({ kind: 'template' }))).toBe(true);
  });

  it('keep templates out of the library list, and list them by name', () => {
    const pages = { a: page({ id: 'a' }), t2: page({ id: 't2', kind: 'template', title: 'Zed' }), t1: page({ id: 't1', kind: 'template', title: 'Alpha' }) };
    expect(libraryPages(pages).map((p) => p.id)).toEqual(['a']);
    expect(templatesOf(pages).map((p) => p.id)).toEqual(['t1', 't2']);
  });

  it('accept only real dates', () => {
    expect(cleanDate('2026-10-19')).toBe('2026-10-19');
    expect(cleanDate('19/10/2026')).toBeNull();
    expect(cleanDate(20261019)).toBeNull();
    expect(normalizePage({ id: 'x', dailyDate: 'soon' as never }).dailyDate).toBeNull();
    expect(normalizePage({ id: 'x' }).kind).toBe('page');
  });
});

describe('copying a page', () => {
  it('gives every box, list item and arrow a new id, and points frames and arrows at the new ids', () => {
    const src = rich();
    const copy = cloneContent(src);
    const oldIds = new Set([...src.blocks.map((b) => b.id), ...src.blocks.flatMap((b) => (b.type === 'checklist' ? b.items.map((i) => i.id) : [])), ...src.arrows.map((a) => a.id)]);
    const newIds = [...copy.blocks.map((b) => b.id), ...copy.blocks.flatMap((b) => (b.type === 'checklist' ? b.items.map((i) => i.id) : [])), ...copy.arrows.map((a) => a.id)];
    expect(newIds.every((id) => !oldIds.has(id))).toBe(true);
    expect(new Set(newIds).size).toBe(newIds.length);
    const frame = copy.blocks.find((b) => b.type === 'frame')!;
    expect(copy.blocks.filter((b) => b.frameId).every((b) => b.frameId === frame.id)).toBe(true);
    expect(copy.arrows).toHaveLength(1); // the arrow to a missing box is dropped
    const [a, s] = [copy.blocks[1].id, copy.blocks[3].id];
    expect(copy.arrows[0]).toMatchObject({ from: a, to: s });
  });

  it('is independent of the original', () => {
    const src = rich();
    const copy = cloneContent(src);
    (copy.blocks[1] as { html: string }).html = '<p>changed</p>';
    (copy.blocks[2] as { items: { text: string }[] }).items[0].text = 'changed';
    expect((src.blocks[1] as { html: string }).html).toBe('<p>zebra</p>');
    expect((src.blocks[2] as { items: { text: string }[] }).items[0].text).toBe('one');
    expect(copy.drawing).toEqual(src.drawing);
  });

  it('makes a template without the page’s group, tags or date', () => {
    const t = templateFrom(rich(), 'Weekly review', 5);
    expect(t).toMatchObject({ kind: 'template', title: 'Weekly review', groupId: null, tags: [], dailyDate: null, color: 'blue', created: 5, rev: 0 });
    expect(t.id).not.toBe('src');
    expect(t.blocks).toHaveLength(4);
  });
});

describe('duplicating', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    history.clear('src');
  });

  it('a template gives a normal page, and a daily page’s copy does not take over its date', () => {
    useNotes.setState({ pages: { src: { ...rich(), kind: 'template' } } });
    const copy = duplicatePage('src')!;
    expect(copy).toMatchObject({ kind: 'page', dailyDate: null, title: 'Weekly copy' });
    expect(copy.id).not.toBe('src');
  });
});

describe('template storage', () => {
  let laptop: NotesStorage;
  let phone: NotesStorage;
  beforeEach(async () => {
    useDevice('laptop');
    laptop = await createTauriStorage();
    useDevice('phone');
    phone = await createTauriStorage();
    useDevice('laptop');
  });
  const save = async (s: NotesStorage, p: Page) => {
    const cur = await s.loadPage(p.id);
    const res = await s.savePage({ ...p, rev: cur?.rev ?? p.rev });
    if (!res.ok) throw new Error('conflict');
    return { ...p, rev: res.rev };
  };
  const send = <T,>(req: SyncRequest) => handleRequest(laptop.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
  const sync = async () => {
    useDevice('phone');
    const r = await syncWithLaptop(phone.sync, send);
    useDevice('laptop');
    return r;
  };

  it('saves the kind and date and reads them back', async () => {
    await save(laptop, page({ id: 't', kind: 'template', title: 'T' }));
    await save(laptop, page({ id: 'd', dailyDate: '2026-10-19' }));
    expect(await laptop.loadPage('t')).toMatchObject({ kind: 'template', dailyDate: null });
    expect(await laptop.loadPage('d')).toMatchObject({ kind: 'page', dailyDate: '2026-10-19' });
    expect((await laptop.loadAll()).pages.map((p) => p.id).sort()).toEqual(['d', 't']);
  });

  it('upgrades a v8 database: every page stays a page with no date', async () => {
    const old = new FakeDatabase();
    old.db.exec(`CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', group_id TEXT, tags TEXT NOT NULL DEFAULT '[]',
      blocks TEXT NOT NULL DEFAULT '[]', arrows TEXT NOT NULL DEFAULT '[]', drawing TEXT NOT NULL DEFAULT '', color TEXT, created INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0, etag TEXT, synced TEXT, deleted INTEGER NOT NULL DEFAULT 0)`);
    old.db.exec(`INSERT INTO pages (id, title, etag, rev) VALUES ('keep', 'Kept', 'e1', 1)`);
    old.db.exec('PRAGMA user_version = 8');
    old.db.exec(`CREATE TABLE page_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'teal', position INTEGER NOT NULL DEFAULT 0, etag TEXT, synced TEXT, deleted INTEGER NOT NULL DEFAULT 0, parent_id TEXT)`);
    old.db.exec(`CREATE TABLE images (id TEXT PRIMARY KEY, file TEXT, mime TEXT, created INTEGER)`);
    old.db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    old.db.exec(`CREATE TABLE page_snapshots (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, taken INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', blocks TEXT NOT NULL, arrows TEXT NOT NULL DEFAULT '[]')`);
    useDevice('upgraded');
    FakeDatabase.next = old;
    const s = await createTauriStorage();
    const p = await s.loadPage('keep');
    expect(p).toMatchObject({ title: 'Kept', kind: 'page', dailyDate: null });
    await save(s, { ...p!, dailyDate: '2026-01-02' });
    expect((await s.loadPage('keep'))?.dailyDate).toBe('2026-01-02');
  });

  it('keeps deleted templates out of the trash, and a deleted page in it', async () => {
    await save(laptop, page({ id: 't', kind: 'template', title: 'Tpl', blocks: [text('a')] }));
    await save(laptop, page({ id: 'p', title: 'Gone', blocks: [text('b')] }));
    await laptop.deletePage('t');
    await laptop.deletePage('p');
    expect((await laptop.listTrash()).map((p) => p.id)).toEqual(['p']);
  });

  it('keeps templates out of search and links, but not real pages', async () => {
    const graph = laptop.graph;
    expect(graph, 'the graph layer should be available in this test').not.toBeNull();
    await save(laptop, page({ id: 'p', title: 'Real', blocks: [text('b')] }));
    await save(laptop, page({ id: 't', kind: 'template', title: 'Tpl', blocks: [text('a')] }));
    await new Promise((r) => setTimeout(r, 50));
    const hits = (await graph.search('zebra')).map((h) => h.pageId);
    expect(hits).toContain('p');
    expect(hits).not.toContain('t');
  });

  it('syncs a template as a template, with its contents', async () => {
    await save(laptop, templateFrom(rich(), 'Weekly review', 5));
    await sync();
    useDevice('phone');
    const got = (await phone.loadAll()).pages;
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: 'template', title: 'Weekly review', dailyDate: null });
    expect(got[0].blocks).toHaveLength(4);
  });

  it('a conflicted copy of a template stays a template, and a copy of a daily page loses its date', async () => {
    await save(laptop, page({ id: 'tpl', kind: 'template', title: 'Tpl' }));
    await save(laptop, page({ id: 'day', title: 'Mon, 19 Oct 2026', dailyDate: '2026-10-19' }));
    await sync();
    await save(laptop, page({ id: 'tpl', kind: 'template', title: 'Tpl (laptop)' }));
    await save(laptop, page({ id: 'day', title: 'Day (laptop)', dailyDate: '2026-10-19' }));
    useDevice('phone');
    await save(phone, page({ id: 'tpl', kind: 'template', title: 'Tpl (phone)' }));
    await save(phone, page({ id: 'day', title: 'Day (phone)', dailyDate: '2026-10-19' }));
    await sync();
    useDevice('phone');
    const all = (await phone.loadAll()).pages;
    const tplCopy = all.find((p) => p.title === 'Tpl (phone) (conflicted copy)')!;
    const dayCopy = all.find((p) => p.title === 'Day (phone) (conflicted copy)')!;
    expect(tplCopy).toMatchObject({ kind: 'template', dailyDate: null });
    expect(dayCopy).toMatchObject({ kind: 'page', dailyDate: null });
    expect(all.find((p) => p.id === 'day')?.dailyDate).toBe('2026-10-19');
  });

  it('empties a purged page’s date and reads an older record as a normal page', async () => {
    await save(laptop, page({ id: 'd', dailyDate: '2026-10-19', blocks: [text('a')] }));
    await laptop.deletePage('d');
    await laptop.purgePage('d');
    const [rec] = (await laptop.sync.getRecords('page', ['d'])) as PageRecord[];
    expect(rec.dailyDate ?? null).toBeNull();

    const old = { id: 'old', etag: 'e1', deleted: false, title: 'Old', groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1 };
    await laptop.sync.applyRemoteIf('page', old as PageRecord, null);
    expect(await laptop.loadPage('old')).toMatchObject({ kind: 'page', dailyDate: null });
  });
});

describe('cloneContent', () => {
  it('copies only the contents, never the page’s own id, title, group, tags or date', () => {
    const copy = cloneContent(rich()) as Record<string, unknown>;
    expect(Object.keys(copy).sort()).toEqual(['arrows', 'blocks', 'drawing']);
  });
});

describe('a deleted page that is edited again', () => {
  it('comes back with its drawing, colour, kind and date', async () => {
    useDevice('revive');
    const s = await createTauriStorage();
    const first = await s.savePage(page({ id: 'r', title: 'Day', dailyDate: '2026-10-19', color: 'pink', drawing: { scene: '{"elements":[]}', preview: '<svg/>', x: 0, y: 0, w: 5, h: 5 } }));
    expect(first.ok).toBe(true);
    await s.deletePage('r');
    const again = await s.savePage(page({ id: 'r', title: 'Day again', dailyDate: '2026-10-20', color: 'blue', kind: 'template', rev: 0 }));
    expect(again.ok).toBe(true);
    expect(await s.loadPage('r')).toMatchObject({ title: 'Day again', dailyDate: '2026-10-20', color: 'blue', kind: 'template', drawing: null });
  });
});
