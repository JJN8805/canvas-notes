import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, fsRoots, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import type { NotesStorage } from '../src/storage/types';
import type { Block, Page } from '../src/types';
import { sha256Hex, packRefs, shareBlocks } from '../src/lib/contentHash';

let raw: FakeDatabase;
let s: NotesStorage;
const blob = (fill: number, type = 'image/png', size = 2000) => new Blob([new Uint8Array(size).fill(fill)], { type });
const imageFiles = () => [...(fsRoots.get('laptop')?.keys() ?? [])].filter((k) => k.includes('images/'));
const count = (sql: string) => Number((raw.db.prepare(sql).get() as { n: number }).n);
const text = (id: string, html: string): Block => ({ id, type: 'note', style: 'text', x: 0, y: 0, w: 100, h: 40, z: 1, html }) as Block;
const page = (id: string, blocks: Block[], extra: Partial<Page> = {}): Page => ({ id, title: id, groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 0, ...extra });
async function save(p: Page): Promise<Page> {
  const cur = await s.loadPage(p.id);
  const res = await s.savePage({ ...p, rev: cur?.rev ?? p.rev });
  if (!res.ok) throw new Error('conflict');
  return { ...p, rev: res.rev };
}

beforeEach(async () => {
  fsRoots.clear();
  useDevice('laptop');
  raw = new FakeDatabase();
  FakeDatabase.next = raw;
  s = await createTauriStorage();
});

describe('pictures are stored once, however often they are added', () => {
  it('gives back the same id for the same bytes, and keeps one file', async () => {
    const a = await s.putImage(blob(7));
    const b = await s.putImage(blob(7));
    const c = await s.putImage(blob(7));
    expect([b, c]).toEqual([a, a]);
    expect(imageFiles()).toHaveLength(1);
    expect(count('SELECT COUNT(*) n FROM images')).toBe(1);
  });
  it('keeps different bytes apart, and the same bytes under a different type', async () => {
    const a = await s.putImage(blob(1));
    const b = await s.putImage(blob(2));
    const c = await s.putImage(blob(1, 'image/jpeg'));
    expect(new Set([a, b, c]).size).toBe(3);
    expect(imageFiles()).toHaveLength(3);
  });
  it('still reads every picture back exactly', async () => {
    const a = await s.putImage(blob(9, 'image/png', 3000));
    const img = await s.sync.readImage(a);
    expect(img?.mime).toBe('image/png');
    expect(atob(img!.data).length).toBe(3000);
  });
  it('a picture arriving from another device under its own id adds no second file', async () => {
    const mine = await s.putImage(blob(5));
    const data = (await s.sync.readImage(mine))!.data;
    await s.sync.writeImage({ id: 'theirs1', mime: 'image/png', data });
    expect(imageFiles()).toHaveLength(1);
    expect(count('SELECT COUNT(*) n FROM images')).toBe(2);
    expect((await s.sync.readImage('theirs1'))?.data).toBe(data); // both ids open the same picture
    await s.sync.writeImage({ id: 'theirs1', mime: 'image/png', data }); // again: nothing happens
    expect(count('SELECT COUNT(*) n FROM images')).toBe(2);
  });
  it('keeps the file while any id still uses it, and removes it with the last', async () => {
    const mine = await s.putImage(blob(5));
    const data = (await s.sync.readImage(mine))!.data;
    await s.sync.writeImage({ id: 'theirs1', mime: 'image/png', data });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3600_000); // pictures from the last ten minutes are never removed
    await s.pruneImages(new Set(['theirs1']));
    expect(await s.sync.readImage('theirs1')).not.toBeNull();
    expect(imageFiles()).toHaveLength(1);
    await s.pruneImages(new Set());
    vi.useRealTimers();
    expect(imageFiles()).toHaveLength(0);
    expect(count('SELECT COUNT(*) n FROM images')).toBe(0);
  });
});

describe('older duplicate files are merged', () => {
  /** Plants files the way earlier versions made them: one file per add, no fingerprint. */
  async function plantOld(id: string, fill: number) {
    const file = `${id}.png`;
    fsRoots.get('laptop')!.set(`images/${file}`, new Uint8Array(2000).fill(fill));
    raw.db.prepare('INSERT INTO images (id, file, mime, created) VALUES (?, ?, ?, ?)').run(id, file, 'image/png', 1);
  }
  it('keeps one file per distinct content, and every id still opens its picture', async () => {
    await plantOld('old1', 3);
    await plantOld('old2', 3);
    await plantOld('old3', 3);
    await plantOld('other', 4);
    expect((await s.report()).pending).toBe(4);
    const r = await s.tidy();
    expect(r).toMatchObject({ filesMerged: 2, bytesFreed: 4000 });
    expect(imageFiles()).toHaveLength(2);
    for (const id of ['old1', 'old2', 'old3']) expect(atob((await s.sync.readImage(id))!.data)).toBe(String.fromCharCode(3).repeat(2000));
    expect(atob((await s.sync.readImage('other'))!.data)).toBe(String.fromCharCode(4).repeat(2000));
    expect((await s.report()).pending).toBe(0);
  });
  it('is safe to run again, and leaves a file it cannot read alone', async () => {
    await plantOld('old1', 3);
    raw.db.prepare('INSERT INTO images (id, file, mime, created) VALUES (?, ?, ?, ?)').run('lost', 'lost.png', 'image/png', 1);
    expect(await s.tidy()).toMatchObject({ filesMerged: 0 });
    expect(await s.tidy()).toEqual({ filesMerged: 0, bytesFreed: 0, versionsConverted: 0 });
    expect(await s.sync.readImage('lost')).toBeNull();
  });
  it('then recognises the same bytes added later', async () => {
    await plantOld('old1', 3);
    await s.tidy();
    const again = await s.putImage(blob(3));
    expect(again).toBe('old1');
  });
});

describe('version history shares boxes', () => {
  const many = (n: number, prefix = 'b') => Array.from({ length: n }, (_, i) => text(`${prefix}${i}`, `<p>box ${prefix}${i} with some words in it</p>`));
  it('a new version adds only the boxes that changed', async () => {
    const blocks = many(12);
    let p = await save(page('a', blocks));
    await s.snapshotPage('a', { force: true });
    expect(count('SELECT COUNT(*) n FROM history_blocks')).toBe(12);
    blocks[3] = text('b3', '<p>changed</p>');
    p = await save({ ...p, blocks: [...blocks] });
    await s.snapshotPage('a', { force: true });
    expect(count('SELECT COUNT(*) n FROM page_snapshots')).toBe(2);
    expect(count('SELECT COUNT(*) n FROM history_blocks')).toBe(13); // not 24
  });
  it('gives every version back exactly as it was', async () => {
    const v1 = many(5);
    await save(page('a', v1));
    await s.snapshotPage('a', { force: true });
    const v2 = [...v1.slice(0, 4), text('b4', '<p>edited</p>'), text('extra', '<p>new box</p>')];
    await save(page('a', v2));
    await s.snapshotPage('a', { force: true });
    const list = await s.listSnapshots('a');
    expect(list).toHaveLength(2);
    expect(list[0].blocks).toEqual(v2);
    expect(list[1].blocks).toEqual(v1);
  });
  it('boxes that two pages have in common are kept once between them', async () => {
    const same = many(6, 'shared');
    await save(page('a', same));
    await save(page('b', same.map((b) => ({ ...b })))); // a duplicated page
    await s.snapshotPage('a', { force: true });
    await s.snapshotPage('b', { force: true });
    expect(count('SELECT COUNT(*) n FROM page_snapshots')).toBe(2);
    expect(count('SELECT COUNT(*) n FROM history_blocks')).toBe(6);
    expect((await s.listSnapshots('b'))[0].blocks).toEqual(same);
  });
  it('does not keep a second copy of an unchanged page', async () => {
    await save(page('a', many(3)));
    expect(await s.snapshotPage('a', { force: true })).toBe(true);
    expect(await s.snapshotPage('a', { force: true })).toBe(false);
    expect(count('SELECT COUNT(*) n FROM page_snapshots')).toBe(1);
  });
  it('removes the stored boxes of history that is no longer kept', async () => {
    await save(page('gone', many(4, 'g')));
    await s.snapshotPage('gone', { force: true });
    expect(count('SELECT COUNT(*) n FROM history_blocks')).toBe(4);
    await s.deletePage('gone');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 40 * 86400_000);
    await s.purgeExpiredTrash(Date.now());
    vi.useRealTimers();
    expect(count('SELECT COUNT(*) n FROM page_snapshots')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM history_blocks')).toBe(0);
  });
  it('keeps a box other history still needs when one version goes', async () => {
    const shared = many(3, 's');
    await save(page('a', shared));
    await save(page('b', shared.map((b) => ({ ...b }))));
    await s.snapshotPage('a', { force: true });
    await s.snapshotPage('b', { force: true });
    await s.deletePage('a');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 40 * 86400_000);
    await s.purgeExpiredTrash(Date.now());
    vi.useRealTimers();
    expect(count('SELECT COUNT(*) n FROM history_blocks')).toBe(3);
    expect((await s.listSnapshots('b'))[0].blocks).toHaveLength(3);
  });
  it('keeps a picture that only an old version uses', async () => {
    const img = await s.putImage(blob(8));
    await save(page('a', [{ id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, imageId: img, aspect: 1 } as Block]));
    await s.snapshotPage('a', { force: true });
    await save(page('a', [text('t', '<p>the picture was removed</p>')]));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3600_000);
    await s.pruneImages(new Set()); // no live page uses it any more
    vi.useRealTimers();
    expect(await s.sync.readImage(img)).not.toBeNull();
  });
});

describe('older version history is converted', () => {
  it('turns versions written out in full into shared boxes, unchanged when read back', async () => {
    const blocks = [text('a', '<p>one</p>'), text('b', '<p>two</p>'), text('c', '<p>three</p>')];
    for (let i = 0; i < 3; i++) {
      raw.db.prepare('INSERT INTO page_snapshots (id, page_id, taken, title, blocks, arrows) VALUES (?, ?, ?, ?, ?, ?)').run(`s${i}`, 'p', 1000 + i, 'T', JSON.stringify(i === 2 ? blocks.slice(0, 2) : blocks), '[]');
    }
    expect((await s.report()).pending).toBe(3);
    expect((await s.listSnapshots('p'))[0].blocks).toHaveLength(2); // readable before it is converted
    expect(await s.tidy()).toMatchObject({ versionsConverted: 3 });
    expect(count("SELECT COUNT(*) n FROM page_snapshots WHERE blocks LIKE '[%'")).toBe(0);
    expect(count('SELECT COUNT(*) n FROM history_blocks')).toBe(3); // three distinct boxes, not eight
    const list = await s.listSnapshots('p');
    expect(list.map((v) => v.blocks.length)).toEqual([2, 3, 3]);
    expect(list[2].blocks).toEqual(blocks);
    expect(await s.tidy()).toMatchObject({ versionsConverted: 0 });
  });
});

describe('the storage report', () => {
  it('says how much is shared', async () => {
    const a = await s.putImage(blob(1, 'image/png', 5000));
    await s.putImage(blob(1, 'image/png', 5000));
    const b = await s.putImage(blob(2, 'image/png', 5000));
    const many = Array.from({ length: 10 }, (_, i) => text(`b${i}`, `<p>${'a few words of ordinary writing in a box '.repeat(8)}${i}</p>`));
    let p = await save(page('a', many));
    await s.snapshotPage('a', { force: true });
    for (let v = 1; v <= 4; v++) {
      many[v] = text(`b${v}`, `<p>edit number ${v}</p>`); // each version changes one box
      p = await save({ ...p, blocks: [...many] });
      await s.snapshotPage('a', { force: true });
    }
    const r = await s.report();
    expect(r).toMatchObject({ pages: 1, versions: 5, historyBoxes: 14, historyBoxUses: 50, files: 2, fileUses: 2, fileBytes: 10000, pending: 0 });
    expect(a).not.toBe(b);
    expect(r.fileBytesIfCopied).toBe(10000); // the repeated add never made a second row
    expect(r.versionBytes).toBeLessThan(r.versionBytesIfCopied / 2);
  });
  it('counts a space saving for files that were copies before they were merged', async () => {
    for (const id of ['x1', 'x2', 'x3']) {
      fsRoots.get('laptop')!.set(`images/${id}.png`, new Uint8Array(1000).fill(9));
      raw.db.prepare('INSERT INTO images (id, file, mime, created) VALUES (?, ?, ?, ?)').run(id, `${id}.png`, 'image/png', 1);
    }
    await s.tidy();
    const r = await s.report();
    expect(r).toMatchObject({ fileUses: 3, files: 1, fileBytes: 1000, fileBytesIfCopied: 3000 });
  });
});

describe('fingerprints used by the database', () => {
  it('match the ones the tests compute', async () => {
    const id = await s.putImage(blob(6, 'image/png', 100));
    const row = raw.db.prepare('SELECT sha256, size FROM images WHERE id = ?').get(id) as { sha256: string; size: number };
    expect(row.sha256).toBe(await sha256Hex(new Uint8Array(100).fill(6)));
    expect(row.size).toBe(100);
    const { refs } = await shareBlocks([text('a', '<p>x</p>')]);
    expect(packRefs(refs)).toContain(refs[0]);
  });
});
