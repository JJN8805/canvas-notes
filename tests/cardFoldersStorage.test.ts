import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { createWebStorage } from '../src/storage/web';
import type { NotesStorage } from '../src/storage/types';
import type { Group, Page } from '../src/types';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import { buildBackup, restoreBackup } from '../src/lib/backup';

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
const send = <T,>(req: SyncRequest): Promise<T> => handleRequest(laptop.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
const sync = () => syncWithLaptop(phone.sync, send);

const page = (id: string, extra: Partial<Page> = {}): Page => ({ id, title: id, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra });
const pageGroup: Group = { id: 'g1', name: 'Work', color: 'teal', parentId: null };
const folder: Group = { id: 'f1', name: 'Plants', color: 'moss', parentId: null, scope: 'cards' };
const section: Group = { id: 'f2', name: 'Indoor', color: 'moss', parentId: 'f1', scope: 'cards' };

beforeEach(async () => {
  laptop = await device('laptop');
  phone = await device('phone');
});

describe('descriptions of card folders', () => {
  const described: Group = { ...folder, description: 'Everything green.\nWatering notes inside.' };
  it('are stored and come back, and a folder without one has none', async () => {
    await laptop.saveGroups([described, section]);
    const { groups } = await laptop.loadAll();
    expect(groups.find((g) => g.id === 'f1')).toEqual(described);
    expect('description' in groups.find((g) => g.id === 'f2')!).toBe(false);
  });
  it('can be changed and removed', async () => {
    await laptop.saveGroups([described]);
    await laptop.saveGroups([{ ...described, description: 'Changed' }]);
    expect((await laptop.loadAll()).groups[0].description).toBe('Changed');
    await laptop.saveGroups([folder]);
    expect('description' in (await laptop.loadAll()).groups[0]).toBe(false);
  });
  it('go to the phone over sync, and a change on the phone comes back', async () => {
    await laptop.saveGroups([described]);
    await sync();
    expect((await phone.loadAll()).groups[0].description).toBe('Everything green.\nWatering notes inside.');
    await phone.saveGroups([{ ...described, description: 'Edited on the phone' }]);
    await sync();
    expect((await laptop.loadAll()).groups[0]).toMatchObject({ scope: 'cards', description: 'Edited on the phone' });
  });
  it('are kept in a backup and restored', async () => {
    await laptop.saveGroups([described]);
    const backup = JSON.parse(JSON.stringify(await buildBackup(laptop)));
    const fresh = await device('restored');
    await restoreBackup(fresh, backup);
    expect((await fresh.loadAll()).groups[0].description).toBe('Everything green.\nWatering notes inside.');
  });
  it('are not kept for a page group, whatever it is given', async () => {
    await laptop.saveGroups([{ ...pageGroup, description: 'should not stick' } as Group]);
    expect('description' in (await laptop.loadAll()).groups[0]).toBe(false);
  });
});

describe('card folders in the desktop database', () => {
  it('are stored beside page groups and come back marked, while page groups stay unmarked', async () => {
    await laptop.saveGroups([pageGroup, folder, section]);
    const { groups } = await laptop.loadAll();
    expect(groups.find((g) => g.id === 'g1')).toEqual(pageGroup);
    expect(groups.find((g) => g.id === 'f1')).toEqual(folder);
    expect(groups.find((g) => g.id === 'f2')).toEqual(section);
  });
  it('can be renamed, and a page group turned into one is noticed as a change', async () => {
    await laptop.saveGroups([pageGroup, folder]);
    await laptop.saveGroups([pageGroup, { ...folder, name: 'Garden' }]);
    expect((await laptop.loadAll()).groups.find((g) => g.id === 'f1')?.name).toBe('Garden');
    await laptop.saveGroups([{ ...pageGroup, scope: 'cards' }, folder]);
    expect((await laptop.loadAll()).groups.find((g) => g.id === 'g1')?.scope).toBe('cards');
  });
  it('are removed from the database when they are left out of a save, like any group', async () => {
    await laptop.saveGroups([pageGroup, folder]);
    await laptop.saveGroups([pageGroup]);
    expect((await laptop.loadAll()).groups.map((g) => g.id)).toEqual(['g1']);
  });
});

describe('card folders over Wi-Fi sync', () => {
  it('reach the phone as folders (with the cards filed in them), not as page groups', async () => {
    await laptop.saveGroups([pageGroup, folder, section]);
    await laptop.savePage({ ...page('card1', { kind: 'card', groupId: 'f2' }), rev: 0 });
    await sync();
    const all = await phone.loadAll();
    expect(all.groups.filter((g) => g.scope === 'cards').map((g) => [g.id, g.parentId])).toEqual([['f1', null], ['f2', 'f1']]);
    expect(all.groups.filter((g) => g.scope !== 'cards').map((g) => g.id)).toEqual(['g1']);
    expect(await phone.sync.getRecords('page', ['card1']).then((r) => (r[0] as { groupId: string }).groupId)).toBe('f2');
    expect(await sync()).toEqual({ sent: 0, received: 0, conflicts: 0, images: 0 });
  });
  it('keep their marker when the phone changes them and the change goes back to the laptop', async () => {
    await laptop.saveGroups([folder]);
    await sync();
    await phone.saveGroups([{ ...folder, name: 'Garden' }]);
    await sync();
    const g = (await laptop.loadAll()).groups[0];
    expect(g).toMatchObject({ id: 'f1', name: 'Garden', scope: 'cards' });
  });
});

describe('card folders in a backup', () => {
  it('are saved and restored as card folders', async () => {
    await laptop.saveGroups([pageGroup, folder, section]);
    const backup = await buildBackup(laptop);
    expect(backup.groups.filter((g) => g.scope === 'cards').map((g) => g.id).sort()).toEqual(['f1', 'f2']);
    const fresh = await device('new');
    await restoreBackup(fresh, JSON.parse(JSON.stringify(backup)));
    const groups = (await fresh.loadAll()).groups;
    expect(groups.find((g) => g.id === 'f2')).toMatchObject({ parentId: 'f1', scope: 'cards' });
    expect(groups.find((g) => g.id === 'g1')?.scope).toBeUndefined();
  });
});

describe('card folders in the browser database', () => {
  it('are stored and returned with their marker too', async () => {
    const web = await createWebStorage(`cf-${Math.random()}`).catch(() => null);
    if (!web) return; // no IndexedDB in this environment: the desktop tests above cover the shared rules
    await web.saveGroups([pageGroup, folder]);
    const { groups } = await web.loadAll();
    expect(groups.find((g) => g.id === 'f1')).toEqual(folder);
    expect(groups.find((g) => g.id === 'g1')).toEqual(pageGroup);
  });
});
