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
import { archivedPages, canArchive, cardsOf, isArchived, libraryPages, listedPages } from '../src/lib/pages';

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



const pagesOf = (...ps: Page[]) => Object.fromEntries(ps.map((p) => [p.id, p]));

describe('the archive: which pages it takes and where they show', () => {
  const a = page('a', { archived: true });
  const b = page('b');
  const c = page('c', { kind: 'card', archived: true });
  const d = page('d', { kind: 'card' });
  const day = page('day', { archived: true, dailyDate: '2026-11-18' });
  const tpl = page('t', { kind: 'template', archived: true });
  it('keeps archived pages out of the library, search lists and counts, and archived cards out of the cards', () => {
    const all = pagesOf(a, b, c, d);
    expect(libraryPages(all).map((p) => p.id)).toEqual(['b']);
    expect(listedPages(all).map((p) => p.id)).toEqual(['b']);
    expect(cardsOf(all).map((p) => p.id)).toEqual(['d']);
  });
  it('lists archived pages and cards in the Archive, newest first', () => {
    const all = pagesOf({ ...a, updated: 5 }, b, { ...c, updated: 9 }, d);
    expect(archivedPages(all).map((p) => p.id)).toEqual(['c', 'a']);
  });
  it('only takes ordinary pages and cards: not templates, journal days or attendance pages', () => {
    expect([a, b, c, d].every(canArchive)).toBe(true);
    expect(canArchive(day)).toBe(false);
    expect(canArchive(tpl)).toBe(false);
    expect(archivedPages(pagesOf(day, tpl))).toEqual([]);
    expect(isArchived(a) && !isArchived(b)).toBe(true);
  });
  it('is cleaned when read: only an explicit true counts', () => {
    expect(normalizePage({ id: 'a', archived: true }).archived).toBe(true);
    for (const bad of [false, 1, 'true', null, {}]) expect(normalizePage({ id: 'a', archived: bad as never })).not.toHaveProperty('archived');
    expect(normalizePage({ id: 'a' })).not.toHaveProperty('archived');
  });
});

describe('the archive in the desktop database', () => {
  it('is saved with the page, comes back, and can be undone', async () => {
    await save(laptop, page('a'));
    expect((await laptop.loadPage('a'))?.archived).toBeUndefined();
    await save(laptop, page('a', { archived: true }));
    expect((await laptop.loadPage('a'))?.archived).toBe(true);
    expect((await laptop.loadAll()).pages.find((p) => p.id === 'a')?.archived).toBe(true);
    const { archived: _gone, ...restored } = page('a');
    void _gone;
    await save(laptop, restored as Page);
    expect((await laptop.loadPage('a'))?.archived).toBeUndefined();
  });
  it('is stored for a new page, and a page that comes back from the Trash', async () => {
    await save(laptop, page('n', { archived: true }));
    expect((await laptop.loadPage('n'))?.archived).toBe(true);
    await laptop.deletePage('n');
    await save(laptop, page('n', { archived: true }));
    expect((await laptop.loadPage('n'))?.archived).toBe(true);
  });
  it('keeps its pictures: the archived page still holds them', async () => {
    const id = await laptop.putImage(new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], { type: 'image/png' }));
    await save(laptop, page('p', { archived: true, cover: id }));
    expect((await laptop.loadPage('p'))?.cover).toBe(id);
    expect(await laptop.sync.readImage(id)).not.toBeNull();
  });
});

describe('the archive over sync and in a backup', () => {
  it('goes to the phone, and a restore comes back', async () => {
    await save(laptop, page('a', { archived: true }));
    await sync();
    expect((await phone.loadPage('a'))?.archived).toBe(true);
    await save(phone, page('a'));
    await sync();
    expect((await laptop.loadPage('a'))?.archived).toBeUndefined();
    expect(await sync()).toEqual({ sent: 0, received: 0, conflicts: 0, images: 0 });
  });
  it('is kept on my copy in a conflict', async () => {
    await save(laptop, page('a'));
    await sync();
    await save(laptop, page('a', { title: 'laptop edit' }));
    await save(phone, page('a', { title: 'phone edit', archived: true }));
    await sync();
    expect((await phone.loadAll()).pages.find((p) => p.title.includes('phone edit'))?.archived).toBe(true);
  });
  it('is saved in a backup and restored', async () => {
    await save(laptop, page('a', { archived: true }));
    const backup = await buildBackup(laptop);
    expect(backup.pages[0].archived).toBe(true);
    const fresh = await device('restored');
    await restoreBackup(fresh, JSON.parse(JSON.stringify(backup)));
    expect((await fresh.loadPage('a'))?.archived).toBe(true);
  });
});

import { linkGraph } from '../src/lib/links';
import { buildTree } from '../src/lib/tree3d';

describe('archived pages stay out of the graph', () => {
  it('leaves them out of the link graph and the library tree', () => {
    const all = pagesOf(page('a', { archived: true, title: 'Away' }), page('b', { title: 'Here' }));
    expect(JSON.stringify(linkGraph(all))).toContain('"b"');
    expect(JSON.stringify(linkGraph(all))).not.toContain('"a"');
    const tree = JSON.stringify(buildTree(all, []));
    expect(tree).toContain('Here');
    expect(tree).not.toContain('Away');
  });
});
