import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import type { NotesStorage } from '../src/storage/types';
import type { Block, Page } from '../src/types';

const text = (id: string, html: string) => ({ id, type: 'text', x: 0, y: 0, w: 280, h: 40, z: 1, html }) as Block;
const page = (id: string, title: string, extra: Partial<Page> = {}): Page => ({
  id, title, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra,
});

/** Opens the app's storage on `db` (creating a fresh database when none is given). */
async function open(db: FakeDatabase = new FakeDatabase()): Promise<NotesStorage> {
  useDevice('laptop');
  FakeDatabase.next = db;
  return createTauriStorage();
}
const settle = async (s: NotesStorage) => s.graph!.idle();

/** The first app version's database: three tables, and a page already in a group. */
async function firstVersionDb(): Promise<FakeDatabase> {
  const old = new FakeDatabase();
  const v1 = [
    `CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', group_id TEXT, tags TEXT NOT NULL DEFAULT '[]',
       blocks TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL, updated INTEGER NOT NULL, rev INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE page_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE images (id TEXT PRIMARY KEY, file TEXT NOT NULL, mime TEXT NOT NULL, created INTEGER NOT NULL)`,
    `INSERT INTO pages VALUES ('old', 'Written long ago', 'g', '["Work","work"]', '[{"id":"b1","type":"text","x":0,"y":0,"w":280,"h":40,"z":1,"html":"<p>remember the milk</p>"}]', 1, 2, 3)`,
    `INSERT INTO pages VALUES ('old2', 'Untagged', NULL, '[]', '[]', 1, 2, 1)`,
    `INSERT INTO page_groups VALUES ('g', 'Old group', 'moss', 0)`,
    `PRAGMA user_version = 1`,
  ];
  for (const sql of v1) await old.execute(sql);
  return old;
}

beforeEach(() => {
  FakeDatabase.backups = [];
  FakeDatabase.failBackup = false;
});

describe('first run of the graph layer on an existing database', () => {
  it('backs up first, then imports pages, blocks, tags and groups without touching the originals', async () => {
    const db = await firstVersionDb();
    const s = await open(db);

    expect(FakeDatabase.backups).toHaveLength(1);
    expect(FakeDatabase.backups[0]).toMatch(/^\/config\/backups\/before-graph-.*\.db$/);

    const g = s.graph!.repo;
    expect((await g.listNodes('page')).map((n) => n.title).sort()).toEqual(['Untagged', 'Written long ago']);
    expect((await g.listNodes('group')).map((n) => n.title)).toEqual(['Old group']);
    expect((await g.listNodes('tag')).map((n) => n.title)).toEqual(['Work']); // "Work" and "work" merged
    expect((await g.listBlocks('old')).map((b) => b.plain_text)).toEqual(['remember the milk']);
    expect(await g.listEdges({ src: 'old', type: 'IN_GROUP' })).toMatchObject([{ dst: 'g' }]);
    expect((await g.searchBlocks('milk'))[0].pageId).toBe('old');

    // The original tables are untouched and still what the app loads.
    const all = await s.loadAll();
    expect(all.pages.map((p) => p.title).sort()).toEqual(['Untagged', 'Written long ago']);
    expect(all.pages.find((p) => p.id === 'old')).toMatchObject({ tags: ['Work', 'work'], groupId: 'g', rev: 3 });
  });

  it('records a device id once and keeps it', async () => {
    const db = await firstVersionDb();
    const first = await open(db);
    const id = first.graph!.repo.deviceId;
    const again = await open(db);
    expect(again.graph!.repo.deviceId).toBe(id);
    expect(db.db.prepare('SELECT id, name FROM devices').all()).toEqual([{ id, name: 'Laptop' }]);
  });

  it('does not back up or import again on later starts', async () => {
    const db = await firstVersionDb();
    await open(db);
    await open(db);
    expect(FakeDatabase.backups).toHaveLength(1);
  });

  it('imports nothing if the backup fails, keeps the app working, and retries next start', async () => {
    const db = await firstVersionDb();
    FakeDatabase.failBackup = true;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await open(db);
    quiet.mockRestore();

    expect(s.graph).toBeNull();
    expect((await s.loadAll()).pages).toHaveLength(2);
    expect(db.db.prepare('SELECT COUNT(*) AS n FROM nodes').get()).toEqual({ n: 0 });
    await s.savePage({ ...(await s.loadPage('old'))!, title: 'Still saves' }); // no graph, no problem

    FakeDatabase.failBackup = false;
    const retry = await open(db);
    expect((await retry.graph!.repo.getNode('old'))!.title).toBe('Still saves');
  });

  it('works from an empty database too', async () => {
    const s = await open();
    expect(s.graph).not.toBeNull();
    expect(await s.graph!.repo.listNodes('page')).toEqual([]);
  });
});

describe('graph stays in step with saves', () => {
  it('mirrors new pages, edits, tag changes and deletion', async () => {
    const s = await open();
    const g = s.graph!.repo;

    const r = await s.savePage(page('p', 'Draft', { blocks: [text('b1', 'first words')], tags: ['a'] }));
    await settle(s);
    expect(r.ok).toBe(true);
    expect((await g.getNode('p'))!.title).toBe('Draft');
    expect(await g.listEdges({ src: 'p', type: 'TAGGED' })).toHaveLength(1);

    const cur = (await s.loadPage('p'))!;
    await s.savePage({ ...cur, title: 'Final', tags: [], blocks: [text('b1', 'second words')] });
    await settle(s);
    expect((await g.getNode('p'))!.title).toBe('Final');
    expect(await g.listEdges({ src: 'p', type: 'TAGGED' })).toEqual([]);
    expect(await g.searchBlocks('first')).toEqual([]);
    expect(await g.searchBlocks('second')).toHaveLength(1);

    await s.deletePage('p');
    await settle(s);
    expect(await g.getNode('p')).toBeNull();
    expect(await g.searchBlocks('second')).toEqual([]);
    // The page tables still hold the tombstone, as before.
    expect((await s.sync.listMeta('page'))[0].deleted).toBe(true);
  });

  it('mirrors groups, including nesting and deletion', async () => {
    const s = await open();
    await s.saveGroups([
      { id: 'g1', name: 'Top', color: 'teal', parentId: null },
      { id: 'g2', name: 'Inner', color: 'plum', parentId: 'g1' },
    ]);
    await settle(s);
    expect(await s.graph!.repo.listEdges({ type: 'PARENT_OF' })).toMatchObject([{ src: 'g1', dst: 'g2' }]);
    await s.saveGroups([{ id: 'g1', name: 'Top', color: 'teal', parentId: null }]);
    await settle(s);
    expect((await s.graph!.repo.listNodes('group')).map((n) => n.id)).toEqual(['g1']);
  });

  it('catches up on a page whose save was never mirrored', async () => {
    const db = new FakeDatabase();
    const s = await open(db);
    await s.savePage(page('p', 'Before'));
    await settle(s);
    // Simulate a crash between the save and its projection: the page row moves on, the graph does not.
    db.db.prepare("UPDATE pages SET title = 'After crash', etag = 'newetag' WHERE id = 'p'").run();
    db.db.prepare("INSERT INTO pages (id, title, tags, blocks, arrows, created, updated, rev, etag, deleted) VALUES ('q', 'Never seen', '[]', '[]', '[]', 1, 1, 1, 'e', 0)").run();

    const restarted = await open(db);
    expect((await restarted.graph!.repo.getNode('p'))!.title).toBe('After crash');
    expect((await restarted.graph!.repo.getNode('q'))!.title).toBe('Never seen');
  });

  it('removes pages that were deleted while the graph was not looking', async () => {
    const db = new FakeDatabase();
    const s = await open(db);
    await s.savePage(page('p', 'Doomed'));
    await settle(s);
    db.db.prepare("UPDATE pages SET deleted = 1 WHERE id = 'p'").run();
    const restarted = await open(db);
    expect(await restarted.graph!.repo.getNode('p')).toBeNull();
  });
});

describe('graph stays in step with sync', () => {
  it('mirrors pages and groups that arrive from the other device', async () => {
    const laptop = await open();
    const phoneDb = new FakeDatabase();
    useDevice('phone');
    FakeDatabase.next = phoneDb;
    const phone = await createTauriStorage();

    await phone.saveGroups([{ id: 'g', name: 'Trip', color: 'ochre', parentId: null }]);
    await phone.savePage(page('p', 'Packing', { groupId: 'g', tags: ['travel'], blocks: [text('b1', 'passport')] }));

    useDevice('laptop');
    const send = <T,>(req: SyncRequest) => handleRequest(laptop.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
    await syncWithLaptop(phone.sync, send);
    await settle(laptop);

    const g = laptop.graph!.repo;
    expect((await g.getNode('p'))!.title).toBe('Packing');
    expect((await g.getNode('g'))!.title).toBe('Trip');
    expect(await g.listEdges({ src: 'p', type: 'IN_GROUP' })).toMatchObject([{ dst: 'g' }]);
    expect(await g.listEdges({ src: 'p', type: 'TAGGED' })).toHaveLength(1);
    expect((await g.searchBlocks('passport'))[0].pageId).toBe('p');
  });

  it('gives a page its group edge even when the page arrives before the group', async () => {
    const laptop = await open();
    await laptop.sync.applyRemote('page', { id: 'p', etag: 'e1', deleted: false, title: 'Early', groupId: 'g', tags: [], blocks: [], arrows: [], created: 1, updated: 1 });
    await settle(laptop);
    expect(await laptop.graph!.repo.listEdges({ type: 'IN_GROUP' })).toEqual([]);
    await laptop.sync.applyRemote('group', { id: 'g', etag: 'e2', deleted: false, name: 'Late', color: 'moss', position: 0, parentId: null });
    await settle(laptop);
    expect(await laptop.graph!.repo.listEdges({ type: 'IN_GROUP' })).toMatchObject([{ src: 'p', dst: 'g' }]);
  });
});
