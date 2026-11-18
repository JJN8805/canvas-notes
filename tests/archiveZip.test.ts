import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { ARCHIVE_FORMAT, backupToZip, isZip, zipToBackup } from '../src/lib/archiveZip';
import { archiveName, DEFAULT_AUTO, INTERVAL, isArchiveName, isDue, parseAuto, toRemove } from '../src/lib/autoArchive';
import { bytesToBase64 } from '../src/storage/types';
import { parseBackup, type Backup } from '../src/lib/backup';

const page = (id: string) => ({ id, etag: 'e', deleted: false, title: id, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 2 }) as unknown as Backup['pages'][number];
const bytes = (n: number, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * seed + 3) & 255);
const backup = (): Backup => ({
  format: 'canvas-notes-backup', version: 1, exported: 1700000000000,
  groups: [{ id: 'g1', name: 'Work', color: 'blue', parentId: null }] as never,
  pages: [page('a'), { ...page('b'), archived: true } as never],
  images: [
    { id: 'img1', mime: 'image/png', data: bytesToBase64(bytes(300)) },
    { id: 'vid1', mime: 'video/mp4', data: bytesToBase64(bytes(5000, 11)) },
    { id: 'aud1', mime: 'audio/mpeg', data: bytesToBase64(bytes(900, 5)) },
  ],
});

describe('the archive file', () => {
  it('is a zip with the files as normal files, the pages as JSON, and a readme', () => {
    const z = backupToZip(backup());
    expect(isZip(z)).toBe(true);
    expect(isZip(z.slice(0, 4))).toBe(true); // the first four bytes are enough (the app only reads those to decide)
    expect(isZip(new TextEncoder().encode('{"format"'))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
    const text = new TextDecoder().decode(z);
    for (const n of ['canvas-notes-archive.json', 'README.txt', 'files/img1.png', 'files/vid1.mp4', 'files/aud1.mp3']) expect(text).toContain(n);
  });
  it('round-trips everything: pages (with archived and groups), pictures, a video and audio, byte for byte', () => {
    const back = zipToBackup(backupToZip(backup()));
    expect(back.pages.map((p) => p.id)).toEqual(['a', 'b']);
    expect((back.pages[1] as { archived?: boolean }).archived).toBe(true);
    expect(back.groups.map((g) => g.name)).toEqual(['Work']);
    expect(back.exported).toBe(1700000000000);
    const by = Object.fromEntries(back.images.map((i) => [i.id, i]));
    expect(by.vid1.mime).toBe('video/mp4');
    for (const i of backup().images) expect(by[i.id].data).toBe(i.data);
  });
  it('can be read by the same code as a .json backup (what comes out is a valid backup)', () => {
    const back = zipToBackup(backupToZip(backup()));
    expect(parseBackup(JSON.stringify(back)).pages).toHaveLength(2);
  });
  it('refuses what is not an archive, with a reason', () => {
    expect(() => zipToBackup(new TextEncoder().encode('hello'))).toThrow(/isn’t a Canvas Notes archive/);
    expect(() => zipToBackup(zipSync({ 'other.txt': new Uint8Array([1]) }))).toThrow(/isn’t a Canvas Notes archive/);
    expect(() => zipToBackup(zipSync({ 'canvas-notes-archive.json': new TextEncoder().encode('{not json') }))).toThrow(/isn’t a Canvas Notes archive/);
    const newer = JSON.stringify({ format: ARCHIVE_FORMAT, version: 9, backup: {} });
    expect(() => zipToBackup(zipSync({ 'canvas-notes-archive.json': new TextEncoder().encode(newer) }))).toThrow(/newer version/);
  });
  it('leaves out files with unsafe ids, unknown types, or no bytes (hostile input)', () => {
    const manifest = {
      format: ARCHIVE_FORMAT, version: 1, exported: 1, counts: {},
      backup: { format: 'canvas-notes-backup', version: 1, exported: 1, groups: [], pages: [page('a')] },
      files: [
        { id: 'ok1', mime: 'image/png', name: 'files/ok1.png' },
        { id: '../evil', mime: 'image/png', name: 'files/evil.png' },
        { id: 'ok2', mime: 'text/html', name: 'files/ok2.html' },
        { id: 'ok3', mime: 'image/png', name: 'files/missing.png' },
        { id: 'ok4', mime: 'image/png', name: '../../etc/passwd' },
      ],
    };
    const z = zipSync({ 'canvas-notes-archive.json': new TextEncoder().encode(JSON.stringify(manifest)), 'files/ok1.png': bytes(10), 'files/evil.png': bytes(10), 'files/ok2.html': bytes(10) });
    expect(zipToBackup(z).images.map((i) => i.id)).toEqual(['ok1']);
  });
});

describe('the automatic archive', () => {
  const H = 3_600_000;
  it('reads its setting safely', () => {
    expect(parseAuto(null)).toEqual(DEFAULT_AUTO);
    expect(parseAuto('{"mode":"weekly","keep":10}')).toEqual({ mode: 'weekly', keep: 10 });
    expect(parseAuto('{"mode":"hourly","keep":"x"}')).toEqual(DEFAULT_AUTO);
    expect(parseAuto('{"mode":"daily","keep":999}').keep).toBe(30);
    expect(parseAuto('{"mode":"daily","keep":0}').keep).toBe(1);
    expect(parseAuto('not json')).toEqual(DEFAULT_AUTO);
  });
  it('is due when switched on and none yet, or the last is older than the interval', () => {
    const daily = { mode: 'daily', keep: 4 } as const;
    expect(isDue({ mode: 'off', keep: 4 }, null, 1e12)).toBe(false);
    expect(isDue(daily, null, 1e12)).toBe(true);
    expect(isDue(daily, 1e12 - 23 * H, 1e12)).toBe(false);
    expect(isDue(daily, 1e12 - 25 * H, 1e12)).toBe(true);
    expect(isDue({ mode: 'weekly', keep: 4 }, 1e12 - INTERVAL.daily * 3, 1e12)).toBe(false);
    expect(isDue({ mode: 'weekly', keep: 4 }, 1e12 - INTERVAL.weekly - 1, 1e12)).toBe(true);
  });
  it('names a file by date, and never overwrites one from the same day', () => {
    const d = new Date(2026, 10, 18, 9, 30);
    expect(archiveName(d)).toBe('canvas-notes-archive-2026-11-18.zip');
    expect(archiveName(d, ['canvas-notes-archive-2026-11-18.zip'])).toBe('canvas-notes-archive-2026-11-18-2.zip');
    expect(archiveName(d, ['canvas-notes-archive-2026-11-18.zip', 'canvas-notes-archive-2026-11-18-2.zip'])).toBe('canvas-notes-archive-2026-11-18-3.zip');
  });
  it('removes only old archive files, keeping the newest and never touching other files', () => {
    const names = ['canvas-notes-archive-2026-11-01.zip', 'canvas-notes-archive-2026-11-18.zip', 'canvas-notes-archive-2026-11-18-2.zip', 'canvas-notes-archive-2026-10-20.zip', 'notes.txt', 'my-archive.zip'];
    expect(isArchiveName('canvas-notes-archive-2026-11-18-2.zip')).toBe(true);
    expect(isArchiveName('my-archive.zip')).toBe(false);
    expect(toRemove(names, 2)).toEqual(['canvas-notes-archive-2026-11-01.zip', 'canvas-notes-archive-2026-10-20.zip']);
    expect(toRemove(names, 10)).toEqual([]);
    expect(toRemove(names, 0)).toHaveLength(3); // never removes the newest one
  });
});
