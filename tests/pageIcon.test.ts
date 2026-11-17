import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { normalizePage, type NotesStorage } from '../src/storage/types';
import type { Page } from '../src/types';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import { buildBackup, restoreBackup } from '../src/lib/backup';
import { cleanIcon } from '../src/lib/pageIcon';

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


describe('a page icon is cleaned', () => {
  it('keeps a short plain mark and drops everything else', () => {
    expect(cleanIcon('📘')).toBe('📘');
    expect(cleanIcon(' 👩‍💻 ')).toBe('👩‍💻');
    expect(cleanIcon('A')).toBe('A');
    for (const bad of ['', '   ', '<b>', 'a&b', '"x"', "it's", 'line\nbreak', 'x'.repeat(40), 42, null, undefined, {}]) expect(cleanIcon(bad)).toBeNull();
    expect(normalizePage({ id: 'a', icon: '⭐' }).icon).toBe('⭐');
    expect(normalizePage({ id: 'a', icon: '<img src=x onerror=1>' }).icon).toBeNull();
    expect(normalizePage({ id: 'a' }).icon).toBeNull();
  });
});

describe('a page icon in the desktop database', () => {
  it('is saved with the page, comes back, and can be changed and removed', async () => {
    const s = laptop;
    await save(s, page('a'));
    expect((await s.loadPage('a'))?.icon ?? null).toBeNull();
    await save(s, page('a', { icon: '📘' }));
    expect((await s.loadPage('a'))?.icon).toBe('📘');
    expect((await s.loadAll()).pages.find((p) => p.id === 'a')?.icon).toBe('📘');
    await save(s, page('a', { icon: null }));
    expect((await s.loadPage('a'))?.icon ?? null).toBeNull();
  });
  it('is not stored when it is unsafe', async () => {
    const s = laptop;
    await save(s, page('b', { icon: '<script>' }));
    expect((await s.loadPage('b'))?.icon ?? null).toBeNull();
  });
});

describe('a page icon over sync and in a backup', () => {
  it('goes to the phone, and a change comes back', async () => {
    await save(laptop, page('a', { icon: '📘' }));
    await sync();
    expect((await phone.loadPage('a'))?.icon).toBe('📘');
    await save(phone, page('a', { icon: '🌱' }));
    await sync();
    expect((await laptop.loadPage('a'))?.icon).toBe('🌱');
    expect(await sync()).toEqual({ sent: 0, received: 0, conflicts: 0, images: 0 });
  });
  it('is kept on my copy in a conflict', async () => {
    await save(laptop, page('a'));
    await sync();
    await save(laptop, page('a', { title: 'laptop edit' }));
    await save(phone, page('a', { title: 'phone edit', icon: '🌱' }));
    await sync();
    expect((await phone.loadAll()).pages.find((p) => p.title.includes('phone edit'))?.icon).toBe('🌱');
  });
  it('is saved in a backup and restored', async () => {
    await save(laptop, page('a', { icon: '📘' }));
    const backup = await buildBackup(laptop);
    expect(backup.pages[0].icon).toBe('📘');
    const fresh = await device('restored');
    await restoreBackup(fresh, JSON.parse(JSON.stringify(backup)));
    expect((await fresh.loadPage('a'))?.icon).toBe('📘');
  });
});
