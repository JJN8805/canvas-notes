import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { createWebStorage } from '../src/storage/web';
import { normalizePage, type NotesStorage } from '../src/storage/types';
import type { Page } from '../src/types';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import { buildBackup, restoreBackup } from '../src/lib/backup';
import { pageFileIds } from '../src/lib/files';
import { usedImageIds } from '../src/store/notes/init';
import type { Group } from '../src/types';

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
const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], { type: 'image/png' });
async function save(s: NotesStorage, p: Page): Promise<Page> {
  const cur = await s.loadPage(p.id);
  const res = await s.savePage({ ...p, rev: cur?.rev ?? p.rev });
  if (!res.ok) throw new Error('unexpected conflict');
  return { ...p, rev: res.rev };
}

beforeEach(async () => {
  laptop = await device('laptop');
  phone = await device('phone');
});

const folder = (id: string, extra: Partial<Group> = {}): Group => ({ id, name: id, color: 'teal', parentId: null, scope: 'cards', ...extra });

describe('a card folder or section picture', () => {
  it('is stored with the folder (cards only), comes back, and an unsafe id is dropped', async () => {
    await laptop.saveGroups([folder('f', { cover: 'c1' }), folder('s', { parentId: 'f', cover: 'c2' }), { id: 'g', name: 'Page group', color: 'plum', parentId: null, cover: 'c3' }, folder('bad', { cover: '../evil' })]);
    const byId = new Map((await laptop.loadAll()).groups.map((g) => [g.id, g]));
    expect(byId.get('f')!.cover).toBe('c1');
    expect(byId.get('s')!.cover).toBe('c2');
    expect(byId.get('g')!.cover).toBeUndefined(); // an ordinary page group has no picture
    expect(byId.get('bad')!.cover).toBeUndefined();
    const before = (await laptop.sync.listMeta('group')).map((m) => m.etag).join();
    await laptop.saveGroups([...byId.values()]);
    expect((await laptop.sync.listMeta('group')).map((m) => m.etag).join()).toBe(before); // unchanged: nothing to sync again
    await laptop.saveGroups([folder('f'), folder('s', { parentId: 'f', cover: 'c9' })]);
    const after = new Map((await laptop.loadAll()).groups.map((g) => [g.id, g]));
    expect(after.get('f')!.cover).toBeUndefined();
    expect(after.get('s')!.cover).toBe('c9');
  });
  it('goes to the phone together with its picture, and a change comes back', async () => {
    useDevice('laptop');
    const id = await laptop.putImage(png());
    await laptop.saveGroups([folder('f', { cover: id })]);
    const r = await sync();
    expect(r.images).toBeGreaterThanOrEqual(1);
    expect((await phone.loadAll()).groups.find((g) => g.id === 'f')?.cover).toBe(id);
    expect(await phone.sync.readImage(id)).not.toBeNull();
    useDevice('phone');
    const second = await phone.putImage(new Blob([new Uint8Array([137, 80, 78, 71, 9, 9, 9])], { type: 'image/png' }));
    await phone.saveGroups([folder('f', { cover: second })]);
    await sync();
    expect((await laptop.loadAll()).groups.find((g) => g.id === 'f')?.cover).toBe(second);
    expect(await laptop.sync.readImage(second)).not.toBeNull();
  });
  it('is saved in a backup with its picture, and restored', async () => {
    useDevice('laptop');
    const id = await laptop.putImage(png());
    await laptop.saveGroups([folder('f', { cover: id })]);
    const backup = await buildBackup(laptop);
    expect(backup.images.map((i) => i.id)).toContain(id);
    const fresh = await device('restored');
    await restoreBackup(fresh, JSON.parse(JSON.stringify(backup)));
    expect((await fresh.loadAll()).groups.find((g) => g.id === 'f')?.cover).toBe(id);
    expect(await fresh.sync.readImage(id)).not.toBeNull();
  });
  it('counts as a file in use, so clean-up keeps it', async () => {
    expect([...usedImageIds([], [folder('f', { cover: 'c1' }), folder('d', {})])]).toEqual(['c1']);
    useDevice('laptop');
    const cover = await laptop.putImage(png());
    const loose = await laptop.putImage(new Blob([new Uint8Array([137, 80, 78, 71, 7, 7, 7, 7])], { type: 'image/png' }));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3600_000);
    await laptop.pruneImages(usedImageIds([], [folder('f', { cover })]));
    vi.useRealTimers();
    expect(await laptop.sync.readImage(cover)).not.toBeNull();
    expect(await laptop.sync.readImage(loose)).toBeNull();
  });
});
