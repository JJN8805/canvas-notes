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
import { cardParts, withCover } from '../src/lib/cards';
import { cleanBlock } from '../src/lib/sanitize';
import { MAX_GIF_BYTES, MAX_VIDEO_BYTES, coverProblem, isVideoFile, videoMimeOf } from '../src/lib/media';
import { FILE_EXT, assertSafeFile } from '../src/storage/validate';
import { pageToMarkdown } from '../src/export/export';
import type { Block, ImageBlock } from '../src/types';

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



const video = () => new Blob([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 1, 2, 3, 4])], { type: 'video/mp4' });

describe('telling what a card picture file is', () => {
  it('knows videos by type, or by extension when the type is empty', () => {
    expect(videoMimeOf({ type: 'video/mp4' })).toBe('video/mp4');
    expect(videoMimeOf({ type: 'video/webm;codecs=vp9' })).toBe('video/webm');
    expect(videoMimeOf({ type: 'video/x-m4v' })).toBe('video/mp4');
    expect(videoMimeOf({ type: '', name: 'clip.MOV' })).toBe('video/quicktime');
    expect(videoMimeOf({ type: '', name: 'clip.webm' })).toBe('video/webm');
    for (const f of [{ type: 'image/gif' }, { type: 'audio/mp4', name: 'a.m4a' }, { type: '', name: 'notes.txt' }, { type: 'video/x-matroska' }]) expect(videoMimeOf(f)).toBe('');
    expect(isVideoFile({ type: 'video/ogg' })).toBe(true);
    expect(isVideoFile({ type: 'image/png' })).toBe(false);
  });
  it('accepts pictures, GIFs and videos, and explains why not otherwise', () => {
    for (const f of [{ type: 'image/png', size: 1e6 }, { type: 'image/jpeg', size: 5e6 }, { type: 'image/gif', size: 2e6 }, { type: 'video/mp4', size: 10e6 }, { type: 'video/webm', size: 1e6 }]) expect(coverProblem(f)).toBeNull();
    expect(coverProblem({ type: 'video/mp4', size: MAX_VIDEO_BYTES + 1 })).toMatch(/video is .*limit/);
    expect(coverProblem({ type: 'image/gif', size: MAX_GIF_BYTES + 1 })).toMatch(/GIF is .*limit/);
    expect(coverProblem({ type: 'image/png', size: 100e6 })).toBeNull(); // pictures are resized, not limited
    expect(coverProblem({ type: 'video/mp4', size: 0 })).toMatch(/empty/);
    expect(coverProblem({ type: 'video/x-matroska', size: 5 })).toMatch(/can’t be kept/);
    expect(coverProblem({ type: 'application/pdf', size: 5 })).toMatch(/choose a picture/);
  });
});

describe('the file store accepts videos', () => {
  it('lists them as known file types', () => {
    for (const m of ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']) {
      expect(FILE_EXT[m]).toBeTruthy();
      expect(() => assertSafeFile({ id: 'v1', mime: m })).not.toThrow();
    }
    expect(() => assertSafeFile({ id: 'v1', mime: 'video/x-matroska' })).toThrow();
    expect(() => assertSafeFile({ id: '../x', mime: 'video/mp4' })).toThrow();
  });
});

describe('a card cover that is a video', () => {
  const body = [{ id: 'b', type: 'note', style: 'text', x: 0, y: 0, w: 320, h: 120, z: 1, html: '' }] as Block[];
  it('is an image box flagged as a video, and a picture can replace it (and back)', () => {
    const v = withCover(body, { imageId: 'v1', aspect: 16 / 9, video: true });
    expect(cardParts({ blocks: v }).cover).toMatchObject({ imageId: 'v1', video: true, h: 180 });
    const p = withCover(v, { imageId: 'i1', aspect: 1 });
    expect(cardParts({ blocks: p }).cover).toMatchObject({ imageId: 'i1' });
    expect(cardParts({ blocks: p }).cover).not.toHaveProperty('video');
    expect(cardParts({ blocks: withCover(p, { imageId: 'v2', aspect: 2, video: true }) }).cover).toMatchObject({ video: true });
  });
  it('keeps the details box below the cover', () => {
    const v = withCover(body, { imageId: 'v1', aspect: 2, video: true });
    expect(cardParts({ blocks: v }).body!.y).toBeGreaterThanOrEqual(160);
  });
  it('is cleaned when read: only an explicit true counts', () => {
    const img = (o: object) => ({ id: 'i', type: 'image', x: 0, y: 0, w: 100, h: 60, z: 1, imageId: 'v1', aspect: 2, ...o }) as unknown as Block;
    expect(cleanBlock(img({ video: true }))).toMatchObject({ video: true });
    for (const bad of [false, 1, 'true', null]) expect(cleanBlock(img({ video: bad }))).not.toHaveProperty('video');
    expect(cleanBlock(img({}))).not.toHaveProperty('video');
  });
  it('is written to Markdown as a link, not a picture', () => {
    const blocks = withCover(body, { imageId: 'v1', aspect: 2, video: true });
    const md = pageToMarkdown({ id: 'c', title: 'Clip', groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 0, kind: 'card' } as Page, (b: ImageBlock) => `images/${b.imageId}.mp4`);
    expect(md).toContain('[🎬 Video](images/v1.mp4)');
    expect(md).not.toContain('![');
  });
});

describe('a video in the desktop database, sync and a backup', () => {
  const card = (id: string, imageId: string): Page =>
    page(id, { kind: 'card', blocks: withCover([{ id: 'b', type: 'note', style: 'text', x: 0, y: 0, w: 320, h: 120, z: 1, html: '' } as Block], { imageId, aspect: 16 / 9, video: true }) });
  it('is stored with its type, comes back, and is the same bytes', async () => {
    const id = await laptop.putImage(video());
    const img = await laptop.sync.readImage(id);
    expect(img?.mime).toBe('video/mp4');
    expect(await laptop.putImage(video())).toBe(id); // the same file is kept once
  });
  it('goes to the phone with the card, flag and file together', async () => {
    const id = await laptop.putImage(video());
    await save(laptop, card('c', id));
    const r = await sync();
    expect(r.images).toBeGreaterThanOrEqual(1);
    const got = await phone.loadPage('c');
    expect(cardParts(got!).cover).toMatchObject({ imageId: id, video: true });
    expect((await phone.sync.readImage(id))?.mime).toBe('video/mp4');
  });
  it('is saved in a backup and restored', async () => {
    const id = await laptop.putImage(video());
    await save(laptop, card('c', id));
    const backup = await buildBackup(laptop);
    expect(backup.images.map((i) => i.mime)).toContain('video/mp4');
    const fresh = await device('restored');
    await restoreBackup(fresh, JSON.parse(JSON.stringify(backup)));
    expect(cardParts((await fresh.loadPage('c'))!).cover).toMatchObject({ video: true });
    expect((await fresh.sync.readImage(id))?.mime).toBe('video/mp4');
  });
});

import { kindOfFile } from '../src/lib/media';
describe('videos on ordinary pages', () => {
  it('are recognised as their own kind of file (a typed video, not an audio .mp4)', () => {
    expect(kindOfFile({ type: 'video/mp4', name: 'a.mp4' })).toBe('video');
    expect(kindOfFile({ type: 'video/webm' })).toBe('video');
    expect(kindOfFile({ type: 'audio/mp4', name: 'a.m4a' })).toBe('audio');
    expect(kindOfFile({ type: '', name: 'song.mp4' })).toBe('audio'); // no type: stays what it always was
    expect(kindOfFile({ type: 'image/gif' })).toBe('image');
    expect(kindOfFile({ type: 'video/x-matroska', name: 'a.mkv' })).toBeNull();
  });
});
