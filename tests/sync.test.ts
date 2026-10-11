import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import type { NotesStorage, PageRecord } from '../src/storage/types';
import type { Page } from '../src/types';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';

/** Wraps a storage so every call runs "on" that device's file system. */
function onDevice(name: string, s: NotesStorage): NotesStorage {
  const wrap = <T extends object>(obj: T): T =>
    new Proxy(obj, {
      get(target, prop) {
        const v = (target as Record<string | symbol, unknown>)[prop];
        if (prop === 'sync') return wrap(v as object);
        if (typeof v !== 'function') return v;
        return async (...args: unknown[]) => {
          useDevice(name);
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  return wrap(s);
}

let laptop: NotesStorage;
let phone: NotesStorage;

async function device(name: string) {
  useDevice(name);
  return onDevice(name, await createTauriStorage());
}

/** The phone talks to the laptop through JSON, exactly like over the network. */
const send = <T,>(req: SyncRequest): Promise<T> =>
  handleRequest(laptop.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);

const sync = () => syncWithLaptop(phone.sync, send);

function page(id: string, title: string, extra: Partial<Page> = {}): Page {
  return { id, title, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra };
}

/** Save the way the app does: with the revision last read from disk. */
async function save(s: NotesStorage, p: Page): Promise<Page> {
  const cur = await s.loadPage(p.id);
  const res = await s.savePage({ ...p, rev: cur?.rev ?? p.rev });
  if (!res.ok) throw new Error('unexpected conflict');
  return { ...p, rev: res.rev };
}

const titles = async (s: NotesStorage) => (await s.loadAll()).pages.map((p) => p.title).sort();

beforeEach(async () => {
  laptop = await device('laptop');
  phone = await device('phone');
});

describe('Wi-Fi sync', () => {
  it('copies pages, groups and images from the laptop to a new phone', async () => {
    await laptop.saveGroups([{ id: 'g1', name: 'ML projects', color: 'teal', parentId: null }]);
    useDevice('laptop');
    const imageId = await laptop.putImage(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
    await save(laptop, page('a', 'Groundwater notes', {
      groupId: 'g1', tags: ['research'],
      blocks: [{ id: 'b1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, imageId, aspect: 1 }],
    }));

    const r = await sync();
    expect(r.received).toBe(2);
    const all = await phone.loadAll();
    expect(all.pages.map((p) => [p.title, p.groupId, p.tags])).toEqual([['Groundwater notes', 'g1', ['research']]]);
    expect(all.groups).toEqual([{ id: 'g1', name: 'ML projects', color: 'teal', parentId: null }]);
    expect((await phone.sync.readImage(imageId))?.data).toBe((await laptop.sync.readImage(imageId))?.data);

    const again = await sync();
    expect(again).toEqual({ sent: 0, received: 0, conflicts: 0, images: 0 });
  });

  it('sends phone edits and new pages (with their images) to the laptop', async () => {
    await save(laptop, page('a', 'Shared'));
    await sync();
    await save(phone, page('a', 'Shared, edited on phone'));
    useDevice('phone');
    const imageId = await phone.putImage(new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }));
    await save(phone, page('b', 'Written on phone', { blocks: [{ id: 'i', type: 'image', x: 0, y: 0, w: 1, h: 1, z: 1, imageId, aspect: 1 }] }));

    const r = await sync();
    expect(r.sent).toBe(2);
    expect(r.images).toBe(1);
    expect(await titles(laptop)).toEqual(['Shared, edited on phone', 'Written on phone']);
    expect(await laptop.sync.readImage(imageId)).not.toBeNull();
  });

  it('keeps both versions when a page was edited on both devices', async () => {
    await save(laptop, page('a', 'Plan'));
    await sync();
    await save(laptop, page('a', 'Plan (laptop edit)'));
    await save(phone, page('a', 'Plan (phone edit)'));

    const r = await sync();
    expect(r.conflicts).toBe(1);
    const expected = ['Plan (laptop edit)', 'Plan (phone edit) (conflicted copy)'];
    expect(await titles(laptop)).toEqual(expected);
    expect(await titles(phone)).toEqual(expected);
    expect((await sync()).conflicts).toBe(0);
  });

  it('syncs deletions both ways', async () => {
    await save(laptop, page('a', 'Keep'));
    await save(laptop, page('b', 'Delete on laptop'));
    await save(laptop, page('c', 'Delete on phone'));
    await sync();
    await laptop.deletePage('b');
    await phone.deletePage('c');
    await sync();
    expect(await titles(laptop)).toEqual(['Keep']);
    expect(await titles(phone)).toEqual(['Keep']);
  });

  it('lets an edit win over a deletion made on the other device', async () => {
    await save(laptop, page('a', 'Draft'));
    await save(laptop, page('b', 'Notes'));
    await sync();
    await phone.deletePage('a');
    await save(laptop, page('a', 'Draft, still needed'));
    await laptop.deletePage('b');
    await save(phone, page('b', 'Notes, edited on phone'));

    const r = await sync();
    expect(r.conflicts).toBe(2);
    const expected = ['Draft, still needed', 'Notes, edited on phone'];
    expect(await titles(laptop)).toEqual(expected);
    expect(await titles(phone)).toEqual(expected);
  });

  it('syncs group changes, including renames and deletions', async () => {
    await laptop.saveGroups([{ id: 'g1', name: 'Work', color: 'teal', parentId: null }, { id: 'g2', name: 'Home', color: 'plum', parentId: null }]);
    await sync();
    await phone.saveGroups([{ id: 'g1', name: 'Work stuff', color: 'brick', parentId: null }]); // renamed g1, removed g2
    await sync();
    expect((await laptop.loadAll()).groups).toEqual([{ id: 'g1', name: 'Work stuff', color: 'brick', parentId: null }]);
  });

  it('syncs subgroups and moving a group into another', async () => {
    await laptop.saveGroups([
      { id: 'work', name: 'Work', color: 'teal', parentId: null },
      { id: 'ml', name: 'ML projects', color: 'teal', parentId: 'work' },
      { id: 'gw', name: 'Groundwater', color: 'teal', parentId: 'ml' },
    ]);
    await sync();
    expect((await phone.loadAll()).groups.map((g) => [g.id, g.parentId])).toEqual([['work', null], ['ml', 'work'], ['gw', 'ml']]);

    // On the phone, move "Groundwater" up to the top level.
    await phone.saveGroups([
      { id: 'work', name: 'Work', color: 'teal', parentId: null },
      { id: 'ml', name: 'ML projects', color: 'teal', parentId: 'work' },
      { id: 'gw', name: 'Groundwater', color: 'teal', parentId: null },
    ]);
    await sync();
    expect((await laptop.loadAll()).groups.find((g) => g.id === 'gw')?.parentId).toBeNull();
  });

  it('reads groups sent by an older app version (no parent field) as top-level', async () => {
    const ok = await laptop.sync.applyRemoteIf(
      'group',
      { id: 'old', etag: 'e1', deleted: false, name: 'From old phone', color: 'plum', position: 0 },
      null,
    );
    expect(ok).toBe(true);
    expect((await laptop.loadAll()).groups).toEqual([{ id: 'old', name: 'From old phone', color: 'plum', parentId: null }]);
  });

  it('reads a page sent by an older app version (no arrows field) without crashing', async () => {
    const old = { id: 'old-page', etag: 'e1', deleted: false, title: 'From old phone', groupId: null, tags: [], blocks: [], created: 1, updated: 1 };
    const ok = await laptop.sync.applyRemoteIf('page', old as unknown as PageRecord, null);
    expect(ok).toBe(true);
    const loaded = await laptop.loadPage('old-page');
    expect(loaded?.arrows).toEqual([]);
  });

  it('syncs an arrow and its edits between devices', async () => {
    await save(laptop, page('a', 'Diagram', {
      blocks: [
        { id: 'b1', type: 'text', x: 0, y: 0, w: 100, h: 40, z: 1, html: '<p>One</p>' },
        { id: 'b2', type: 'text', x: 300, y: 0, w: 100, h: 40, z: 2, html: '<p>Two</p>' },
      ],
      arrows: [{ id: 'arr1', from: 'b1', to: 'b2', heads: 'one', style: 'solid', z: 1 }],
    }));
    await sync();
    const onPhone = (await phone.loadAll()).pages.find((p) => p.id === 'a');
    expect(onPhone?.arrows).toEqual([{ id: 'arr1', from: 'b1', to: 'b2', heads: 'one', style: 'solid', z: 1 }]);

    await save(phone, { ...onPhone!, arrows: [{ ...onPhone!.arrows[0], label: 'leads to', style: 'dashed' as const }] });
    await sync();
    const onLaptop = (await laptop.loadAll()).pages.find((p) => p.id === 'a');
    expect(onLaptop?.arrows).toEqual([{ id: 'arr1', from: 'b1', to: 'b2', heads: 'one', style: 'dashed', label: 'leads to', z: 1 }]);
  });

  it('syncs a frame block and its contained box like any other block', async () => {
    await save(laptop, page('a', 'Board', {
      blocks: [
        { id: 'f1', type: 'frame', x: 0, y: 0, w: 400, h: 300, z: 1, title: 'Ideas', color: 'teal', collapsed: false },
        { id: 'b1', type: 'text', x: 10, y: 40, w: 100, h: 40, z: 2, html: '<p>One</p>', frameId: 'f1' },
      ],
    }));
    await sync();
    const onPhone = (await phone.loadAll()).pages.find((p) => p.id === 'a');
    expect(onPhone?.blocks.find((b) => b.id === 'f1')).toMatchObject({ type: 'frame', title: 'Ideas', collapsed: false });
    expect(onPhone?.blocks.find((b) => b.id === 'b1')).toMatchObject({ frameId: 'f1' });

    await save(phone, { ...onPhone!, blocks: onPhone!.blocks.map((b) => (b.id === 'f1' ? { ...b, collapsed: true } : b)) });
    await sync();
    const onLaptop = (await laptop.loadAll()).pages.find((p) => p.id === 'a');
    expect(onLaptop?.blocks.find((b) => b.id === 'f1')).toMatchObject({ collapsed: true });
  });

  it('never lets the phone overwrite a laptop change it has not seen', async () => {
    await save(laptop, page('a', 'v1'));
    await sync();
    const meta = (await phone.sync.listMeta('page'))[0];
    await save(laptop, page('a', 'v2 on laptop'));
    const rec = (await phone.sync.getRecords('page', ['a']))[0];
    const ok = await laptop.sync.applyRemoteIf('page', { ...rec, title: 'stale', etag: 'x' }, meta.synced);
    expect(ok).toBe(false);
    expect(await titles(laptop)).toEqual(['v2 on laptop']);
  });

  it('converges after many mixed edits', async () => {
    for (let i = 0; i < 12; i++) await save(i % 2 ? laptop : phone, page('p' + i, 'Page ' + i));
    await sync();
    for (let i = 0; i < 12; i += 3) await save(phone, page('p' + i, 'Page ' + i + ' phone'));
    for (let i = 1; i < 12; i += 4) await save(laptop, page('p' + i, 'Page ' + i + ' laptop'));
    await laptop.deletePage('p2');
    await sync();
    expect(await titles(phone)).toEqual(await titles(laptop));
    // 12 pages − 1 deleted + 1 conflicted copy (page 9 was edited on both devices)
    const t = await titles(laptop);
    expect(t.length).toBe(12);
    expect(t).toContain('Page 9 phone (conflicted copy)');
    expect(t).not.toContain('Page 2');
    expect(await sync()).toEqual({ sent: 0, received: 0, conflicts: 0, images: 0 });
  });
});

describe('Local saving with tombstones', () => {
  it('restores a deleted page when it is saved again (Undo after delete)', async () => {
    const p = await save(laptop, page('a', 'Oops'));
    await laptop.deletePage('a');
    expect(await laptop.loadPage('a')).toBeNull();
    const res = await laptop.savePage({ ...p, rev: 0 });
    expect(res.ok).toBe(true);
    expect((await laptop.loadPage('a'))?.title).toBe('Oops');
  });

  it('still reports a conflict when another window saved first', async () => {
    const p = await save(laptop, page('a', 'One'));
    await laptop.savePage({ ...p, title: 'Two' });
    expect((await laptop.savePage({ ...p, title: 'Three' })).ok).toBe(false);
  });

  it('upgrades a database made by the first version without losing anything', async () => {
    const old = new FakeDatabase();
    const v1 = [
      `CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', group_id TEXT, tags TEXT NOT NULL DEFAULT '[]',
         blocks TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL, updated INTEGER NOT NULL, rev INTEGER NOT NULL DEFAULT 0)`,
      `CREATE TABLE page_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0)`,
      `CREATE TABLE images (id TEXT PRIMARY KEY, file TEXT NOT NULL, mime TEXT NOT NULL, created INTEGER NOT NULL)`,
      `INSERT INTO pages VALUES ('old', 'Written before sync existed', 'g', '["x"]', '[]', 1, 2, 3)`,
      `INSERT INTO page_groups VALUES ('g', 'Old group', 'moss', 0)`,
      `PRAGMA user_version = 1`,
    ];
    for (const sql of v1) await old.execute(sql);
    FakeDatabase.next = old;
    const upgraded = await device('upgraded');

    const all = await upgraded.loadAll();
    expect(all.pages.map((p) => [p.title, p.groupId, p.tags, p.arrows, p.rev])).toEqual([['Written before sync existed', 'g', ['x'], [], 3]]);
    expect(all.groups).toEqual([{ id: 'g', name: 'Old group', color: 'moss', parentId: null }]);
    const meta = await upgraded.sync.listMeta('page');
    expect(meta[0].etag).toMatch(/^[0-9a-f]{18}$/);
    expect(meta[0].synced).toBeNull(); // so it will be sent on the first sync

    // And it syncs like any other data.
    laptop = upgraded;
    await sync();
    expect(await titles(phone)).toEqual(['Written before sync existed']);
  });
});
