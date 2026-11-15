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

describe('a page cover is cleaned on read', () => {
  it('keeps a safe picture id and drops anything else', () => {
    expect(normalizePage({ id: 'a', cover: 'img_1-x' }).cover).toBe('img_1-x');
    expect(normalizePage({ id: 'a' }).cover).toBeNull();
    expect(normalizePage({ id: 'a', cover: '' }).cover).toBeNull();
    expect(normalizePage({ id: 'a', cover: '../../etc/passwd' }).cover).toBeNull();
    expect(normalizePage({ id: 'a', cover: 42 as unknown as string }).cover).toBeNull();
  });
  it('counts as a file the page uses', () => {
    expect(pageFileIds({ blocks: [], cover: 'c1' })).toEqual(['c1']);
    expect(pageFileIds({ blocks: [{ id: 'b', type: 'image', x: 0, y: 0, w: 1, h: 1, z: 1, imageId: 'i1', aspect: 1 }], cover: 'c1' }).sort()).toEqual(['c1', 'i1']);
    expect(pageFileIds({ blocks: [], cover: null })).toEqual([]);
    expect([...usedImageIds([page('a', { cover: 'c1' }), page('b')])]).toEqual(['c1']);
  });
});

describe('a page cover in the desktop database', () => {
  it('is saved with the page, comes back, and can be changed and removed', async () => {
    await save(laptop, page('a'));
    expect((await laptop.loadPage('a'))?.cover).toBeNull();
    await save(laptop, page('a', { cover: 'c1' }));
    expect((await laptop.loadPage('a'))?.cover).toBe('c1');
    expect((await laptop.loadAll()).pages[0].cover).toBe('c1');
    await save(laptop, page('a', { cover: 'c2' }));
    expect((await laptop.loadPage('a'))?.cover).toBe('c2');
    await save(laptop, page('a', { cover: null }));
    expect((await laptop.loadPage('a'))?.cover).toBeNull();
  });
  it('is stored for a brand-new page too, and for one that comes back from the Trash', async () => {
    await save(laptop, page('n', { cover: 'c1' }));
    expect((await laptop.loadPage('n'))?.cover).toBe('c1');
    await laptop.deletePage('n');
    await save(laptop, page('n', { cover: 'c9' }));
    expect((await laptop.loadPage('n'))?.cover).toBe('c9');
  });
  it('is never stored when the id is unsafe', async () => {
    await save(laptop, page('a', { cover: '../evil' }));
    expect((await laptop.loadPage('a'))?.cover).toBeNull();
  });
});

describe('a page cover over Wi-Fi sync', () => {
  it('goes to the phone together with its picture, and a change comes back', async () => {
    useDevice('laptop');
    const id = await laptop.putImage(png());
    await save(laptop, page('a', { cover: id }));
    const r = await sync();
    expect(r.images).toBeGreaterThanOrEqual(1);
    expect((await phone.loadPage('a'))?.cover).toBe(id);
    expect(await phone.sync.readImage(id)).not.toBeNull();
    useDevice('phone');
    const second = await phone.putImage(new Blob([new Uint8Array([137, 80, 78, 71, 9, 9, 9])], { type: 'image/png' }));
    await save(phone, page('a', { cover: second }));
    await sync();
    expect((await laptop.loadPage('a'))?.cover).toBe(second);
    expect(await laptop.sync.readImage(second)).not.toBeNull();
    expect(await sync()).toEqual({ sent: 0, received: 0, conflicts: 0, images: 0 });
  });
  it('is kept on my copy when two devices edit the same page at once', async () => {
    await save(laptop, page('a'));
    await sync();
    await save(laptop, page('a', { title: 'laptop edit' }));
    useDevice('phone');
    const id = await phone.putImage(png());
    await save(phone, page('a', { title: 'phone edit', cover: id }));
    await sync();
    const all = (await phone.loadAll()).pages;
    const mine = all.find((p) => p.title.includes('phone edit'));
    expect(mine?.cover).toBe(id);
  });
});

describe('a page cover in a backup', () => {
  it('is saved with its picture and restored', async () => {
    useDevice('laptop');
    const id = await laptop.putImage(png());
    await save(laptop, page('a', { cover: id }));
    const backup = await buildBackup(laptop);
    expect(backup.images.map((i) => i.id)).toContain(id);
    expect(backup.pages[0].cover).toBe(id);
    const fresh = await device('restored');
    await restoreBackup(fresh, JSON.parse(JSON.stringify(backup)));
    expect((await fresh.loadPage('a'))?.cover).toBe(id);
    expect(await fresh.sync.readImage(id)).not.toBeNull();
  });
});

describe('cleaning up pictures', () => {
  it('keeps a picture that is only a cover, and removes one that nothing uses', async () => {
    useDevice('laptop');
    const cover = await laptop.putImage(png());
    const loose = await laptop.putImage(new Blob([new Uint8Array([137, 80, 78, 71, 7, 7, 7, 7])], { type: 'image/png' }));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3600_000); // pictures made in the last ten minutes are never removed
    await laptop.pruneImages(new Set([cover]));
    vi.useRealTimers();
    expect(await laptop.sync.readImage(cover)).not.toBeNull();
    expect(await laptop.sync.readImage(loose)).toBeNull();
  });
  it('keeps the cover of a page in the Trash, which can come back', async () => {
    useDevice('laptop');
    const cover = await laptop.putImage(png());
    await save(laptop, page('t', { cover }));
    await laptop.deletePage('t');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3600_000);
    await laptop.pruneImages(new Set());
    vi.useRealTimers();
    expect(await laptop.sync.readImage(cover)).not.toBeNull();
  });
});

describe('a page cover in the browser database', () => {
  it('is stored and returned too', async () => {
    const web = await createWebStorage(`cover-${Math.random()}`).catch(() => null);
    if (!web) return; // no IndexedDB here: the real browser check covers it
    const res = await web.savePage({ ...page('a', { cover: 'c1' }), rev: 0 });
    expect(res.ok).toBe(true);
    expect((await web.loadPage('a'))?.cover).toBe('c1');
  });
});
