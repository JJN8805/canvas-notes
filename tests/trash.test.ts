import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import type { NotesStorage, PageRecord } from '../src/storage/types';
import type { Block, Page } from '../src/types';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';

const H = 3600_000;
const D = 24 * H;
const T0 = new Date(2026, 5, 1, 9, 0).getTime();

let a: NotesStorage;
let b: NotesStorage;

const page = (id: string, title: string, extra: Partial<Page> = {}): Page => ({ id, title, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra });
const text = (id: string, html: string) => ({ id, type: 'text', x: 0, y: 0, w: 200, h: 40, z: 1, html }) as Block;
const image = (id: string, imageId: string) => ({ id, type: 'image', x: 0, y: 0, w: 200, h: 100, z: 2, imageId }) as Block;

async function save(s: NotesStorage, p: Page): Promise<Page> {
  const cur = await s.loadPage(p.id);
  const res = await s.savePage({ ...p, rev: cur?.rev ?? p.rev });
  if (!res.ok) throw new Error('conflict');
  return { ...p, rev: res.rev };
}
const at = (t: number) => vi.setSystemTime(t);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(T0);
  useDevice('a');
  a = await createTauriStorage();
  useDevice('b');
  b = await createTauriStorage();
  useDevice('a');
});
afterEach(() => vi.useRealTimers());

describe('Trash', () => {
  it('lists deleted pages, newest deletion first, and a save brings one back', async () => {
    await save(a, page('1', 'First', { blocks: [text('t', 'one')] }));
    await save(a, page('2', 'Second', { blocks: [text('t', 'two')] }));
    await a.deletePage('1');
    at(T0 + H);
    await a.deletePage('2');
    expect((await a.listTrash()).map((p) => [p.id, p.updated])).toEqual([['2', T0 + H], ['1', T0]]);
    expect((await a.listTrash())[1].blocks).toHaveLength(1);

    const [first] = (await a.listTrash()).slice(1);
    await a.savePage({ ...first, rev: 0 }); // what Restore does
    expect((await a.loadAll()).pages.map((p) => p.id)).toEqual(['1']);
    expect((await a.listTrash()).map((p) => p.id)).toEqual(['2']);
  });

  it('purging keeps the tombstone but empties it, with a new etag so it syncs', async () => {
    await save(a, page('1', 'Secret', { blocks: [text('t', 'x')], tags: ['k'] }));
    await a.deletePage('1');
    const before = (await a.sync.listMeta('page'))[0];
    await a.purgePage('1');
    const after = (await a.sync.listMeta('page'))[0];
    expect(after.deleted).toBe(true);
    expect(after.etag).not.toBe(before.etag);
    const [rec] = (await a.sync.getRecords('page', ['1'])) as PageRecord[];
    expect([rec.title, rec.tags, rec.blocks, rec.arrows]).toEqual(['', [], [], []]);
    expect(await a.listTrash()).toEqual([]);
  });

  it('does not purge a live page', async () => {
    await save(a, page('1', 'Live', { blocks: [text('t', 'x')] }));
    await a.purgePage('1');
    expect((await a.loadPage('1'))?.title).toBe('Live');
  });

  it('auto-purges only pages deleted before the cutoff, and only once', async () => {
    await save(a, page('old', 'Old', { blocks: [text('t', 'x')] }));
    await a.deletePage('old');
    at(T0 + 40 * D);
    await save(a, page('new', 'New', { blocks: [text('t', 'y')] }));
    await a.deletePage('new');
    expect(await a.purgeExpiredTrash(Date.now() - 30 * D)).toBe(1);
    expect((await a.listTrash()).map((p) => p.id)).toEqual(['new']);
    expect(await a.purgeExpiredTrash(Date.now() - 30 * D)).toBe(0);
    const etag = (await a.sync.listMeta('page')).find((m) => m.id === 'old')!.etag;
    await a.purgeExpiredTrash(Date.now() - 30 * D);
    expect((await a.sync.listMeta('page')).find((m) => m.id === 'old')!.etag).toBe(etag);
  });

  it('keeps images of trashed pages until the page is purged', async () => {
    const id = await a.putImage(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    await save(a, page('1', 'Pic', { blocks: [image('i', id)] }));
    await a.deletePage('1');
    at(T0 + H);
    expect(await a.pruneImages(new Set())).toBe(0);
    await a.purgePage('1');
    expect(await a.pruneImages(new Set())).toBe(1);
  });

  it('a purge reaches the other device, and a live edit there still wins', async () => {
    const send = <T,>(req: SyncRequest): Promise<T> => handleRequest(a.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
    await save(a, page('1', 'Shared', { blocks: [text('t', 'x')] }));
    await save(a, page('2', 'Edited elsewhere', { blocks: [text('t', 'x')] }));
    useDevice('b');
    await syncWithLaptop(b.sync, send);
    useDevice('a');
    await a.deletePage('1');
    await a.deletePage('2');
    useDevice('b');
    await syncWithLaptop(b.sync, send);
    expect((await b.listTrash()).map((p) => p.id).sort()).toEqual(['1', '2']);

    useDevice('a');
    await a.purgePage('1');
    await a.purgePage('2');
    useDevice('b');
    await save(b, { ...(await b.listTrash()).find((p) => p.id === '2')!, title: 'Edited elsewhere again' }); // revives it on b
    await syncWithLaptop(b.sync, send);
    expect(await b.listTrash()).toEqual([]); // 1 is blank now
    expect((await b.loadAll()).pages.map((p) => p.title)).toEqual(['Edited elsewhere again']);
  });
});

describe('History', () => {
  const versions = async (id: string) => (await a.listSnapshots(id)).map((s) => s.title);

  it('keeps the page as it was before a save, at most once an hour', async () => {
    let p = await save(a, page('1', 'v1', { blocks: [text('t', 'a')] }));
    expect(await versions('1')).toEqual([]); // nothing existed before the first save
    p = await save(a, { ...p, title: 'v2' });
    expect(await versions('1')).toEqual(['v1']);
    at(T0 + 30 * 60_000);
    p = await save(a, { ...p, title: 'v3' });
    expect(await versions('1')).toEqual(['v1']); // too soon
    at(T0 + 61 * 60_000);
    p = await save(a, { ...p, title: 'v4' });
    expect(await versions('1')).toEqual(['v3', 'v1']);
    expect((await a.listSnapshots('1'))[0].blocks).toHaveLength(1);
  });

  it('skips blank pages and copies of the newest version', async () => {
    let p = await save(a, page('1', '', {}));
    p = await save(a, { ...p, title: 'x' });
    expect(await versions('1')).toEqual([]); // the blank page was not kept
    expect(await a.snapshotPage('1', { force: true })).toBe(true);
    expect(await a.snapshotPage('1', { force: true })).toBe(false); // identical to the newest
    expect(await versions('1')).toEqual(['x']);
  });

  it('forced snapshots ignore the hourly limit', async () => {
    await save(a, page('1', 'v1', { blocks: [text('t', 'a')] }));
    expect(await a.snapshotPage('1')).toBe(true);
    await save(a, page('1', 'v2', { blocks: [text('t', 'b')] }));
    expect(await a.snapshotPage('1')).toBe(false);
    expect(await a.snapshotPage('1', { force: true })).toBe(true);
  });

  it('thins old versions to one a day and drops those past 30 days', async () => {
    let p = await save(a, page('1', 'v0', { blocks: [text('t', '0')] }));
    for (let i = 1; i <= 6; i++) {
      at(T0 + i * 2 * H);
      p = await save(a, { ...p, title: `v${i}`, blocks: [text('t', String(i))] });
    }
    expect((await a.listSnapshots('1')).length).toBe(6);
    at(T0 + 10 * D);
    p = await save(a, { ...p, title: 'later', blocks: [text('t', 'later')] });
    // v0..v5 were all taken on day one: only the newest of them survives next to the fresh one.
    expect(await versions('1')).toEqual(['v6', 'v5']);
    at(T0 + 50 * D);
    await save(a, { ...p, title: 'much later', blocks: [text('t', 'much later')] });
    expect(await versions('1')).toEqual(['later']);
  });

  it('keeps the local version when a sync replaces it', async () => {
    const send = <T,>(req: SyncRequest): Promise<T> => handleRequest(a.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
    await save(a, page('1', 'from laptop', { blocks: [text('t', 'a')] }));
    useDevice('b');
    await syncWithLaptop(b.sync, send);
    at(T0 + 5 * H);
    useDevice('a');
    await save(a, { ...(await a.loadPage('1'))!, title: 'edited on laptop' });
    at(T0 + 6 * H);
    useDevice('b');
    await syncWithLaptop(b.sync, send); // b has no local edits, so the laptop's version replaces its copy
    expect((await b.loadPage('1'))?.title).toBe('edited on laptop');
    expect((await b.listSnapshots('1')).map((s) => s.title)).toEqual(['from laptop']);
  });

  it('is never part of what syncs, and is removed with a purged page', async () => {
    const send = <T,>(req: SyncRequest): Promise<T> => handleRequest(a.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
    let p = await save(a, page('1', 'v1', { blocks: [text('t', 'a')] }));
    p = await save(a, { ...p, title: 'v2' });
    expect(JSON.stringify(await a.sync.getRecords('page', ['1']))).not.toContain('snapshot');
    useDevice('b');
    await syncWithLaptop(b.sync, send);
    expect(await b.listSnapshots('1')).toEqual([]);
    useDevice('a');
    await a.deletePage('1');
    expect((await a.listSnapshots('1')).length).toBe(1); // kept while the page can still be restored
    await a.purgePage('1');
    expect(await a.listSnapshots('1')).toEqual([]);
  });
});
