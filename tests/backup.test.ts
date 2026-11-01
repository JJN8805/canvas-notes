import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { buildBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import type { NotesStorage } from '../src/storage/types';
import type { Block, Page } from '../src/types';

const page = (id: string, title: string, extra: Partial<Page> = {}): Page => ({ id, title, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra });
const text = (id: string, html: string) => ({ id, type: 'text', x: 0, y: 0, w: 200, h: 40, z: 1, html }) as Block;

let a: NotesStorage;
let b: NotesStorage;

beforeEach(async () => {
  useDevice('a');
  a = await createTauriStorage();
  useDevice('b');
  b = await createTauriStorage();
});

describe('backup', () => {
  it('round-trips pages, groups and images into another library', async () => {
    useDevice('a');
    const imageId = await a.putImage(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    await a.saveGroups([{ id: 'g1', name: 'Work', color: 'teal', parentId: null }]);
    await a.savePage(page('p1', 'One', { groupId: 'g1', tags: ['x'], blocks: [text('t', 'hello'), { id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 2, imageId } as Block] }));
    await a.savePage(page('p2', 'Gone', { blocks: [text('t', 'bye')] }));
    await a.deletePage('p2');

    const backup = parseBackup(JSON.stringify(await buildBackup(a)));
    expect(backup.pages.map((p) => p.id)).toEqual(['p1']);
    expect(backup.images).toHaveLength(1);

    useDevice('b');
    const r = await restoreBackup(b, backup);
    expect(r).toEqual({ pages: 1, skipped: 0, groups: 1 });
    const { pages, groups } = await b.loadAll();
    expect(pages.map((p) => [p.id, p.title, p.groupId, p.tags])).toEqual([['p1', 'One', 'g1', ['x']]]);
    expect(groups.map((g) => g.name)).toEqual(['Work']);
    expect(await b.sync.listImageIds()).toEqual([imageId]);
  });

  it('never overwrites a page that already exists', async () => {
    useDevice('a');
    await a.savePage(page('p1', 'Original', { blocks: [text('t', 'a')] }));
    const backup = await buildBackup(a);

    useDevice('b');
    await b.savePage(page('p1', 'Edited here', { blocks: [text('t', 'b')] }));
    const r = await restoreBackup(b, backup);
    expect(r.pages).toBe(0);
    expect(r.skipped).toBe(1);
    expect((await b.loadPage('p1'))!.title).toBe('Edited here');
  });

  it('refuses files that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow(/isn’t a Canvas Notes backup/);
    expect(() => parseBackup('{"format":"other","pages":[]}')).toThrow(/isn’t a Canvas Notes backup/);
    expect(() => parseBackup('{"format":"canvas-notes-backup","version":9,"pages":[]}')).toThrow(/newer version/);
  });
});
