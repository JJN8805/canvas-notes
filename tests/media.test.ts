import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';
import { memoryGraph } from './graphdb';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import type { NotesStorage } from '../src/storage/types';
import type { AudioBlock, Block, Page, PdfBlock } from '../src/types';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import { buildBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import { fileIdsOf } from '../src/lib/files';
import { clampPage, formatDuration, formatSize, kindOfFile, MAX_MEDIA_BYTES, mediaProblem, mimeOf, nameFromFile } from '../src/lib/media';
import { assertSafeImage } from '../src/storage/validate';
import { pageToMarkdown } from '../src/export/export';
import { blockText } from '../src/lib/util';
import { searchPages } from '../src/lib/search';
import { GraphMirror } from '../src/graph/mirror';

const audio = (id: string, fileId: string, extra: Partial<AudioBlock> = {}): AudioBlock => ({ id, type: 'audio', x: 0, y: 0, w: 320, h: 88, z: 1, fileId, name: 'Standup', ...extra });
const pdf = (id: string, fileId: string, extra: Partial<PdfBlock> = {}): PdfBlock => ({ id, type: 'pdf', x: 0, y: 0, w: 360, h: 480, z: 2, fileId, name: 'Contract', pages: 3, ...extra });
const page = (id: string, title: string, blocks: Block[] = [], extra: Partial<Page> = {}): Page => ({ id, title, groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 0, ...extra });
const bytes = (...n: number[]) => new Uint8Array(n);

describe('telling files apart', () => {
  it('reads the type from the file, or from the name when the type is empty', () => {
    expect(mimeOf({ type: 'audio/webm;codecs=opus' })).toBe('audio/webm');
    expect(mimeOf({ type: 'audio/x-wav' })).toBe('audio/wav');
    expect(mimeOf({ type: 'audio/mp3' })).toBe('audio/mpeg');
    expect(mimeOf({ type: '', name: 'Minutes.PDF' })).toBe('application/pdf');
    expect(mimeOf({ type: '', name: 'take1.m4a' })).toBe('audio/mp4');
    expect(mimeOf({ type: '', name: 'notes.txt' })).toBe('');
  });

  it('sorts files into pictures, audio, PDFs, and nothing', () => {
    expect(kindOfFile({ type: 'image/png' })).toBe('image');
    expect(kindOfFile({ type: 'audio/mpeg', name: 'a.mp3' })).toBe('audio');
    expect(kindOfFile({ type: 'application/pdf' })).toBe('pdf');
    expect(kindOfFile({ type: '', name: 'x.wav' })).toBe('audio');
    for (const bad of [{ type: 'text/html' }, { type: 'video/mp4', name: 'v.mp4' }, { type: 'application/zip' }, { type: '' }]) expect(kindOfFile(bad), JSON.stringify(bad)).toBeNull();
  });

  it('refuses empty, oversized and wrong-kind files with a reason', () => {
    expect(mediaProblem({ type: 'audio/mpeg', size: 1000 }, 'audio')).toBeNull();
    expect(mediaProblem({ type: 'application/pdf', size: 1000 }, 'pdf')).toBeNull();
    expect(mediaProblem({ type: 'audio/mpeg', size: 0 }, 'audio')).toMatch(/empty/);
    expect(mediaProblem({ type: 'audio/mpeg', size: MAX_MEDIA_BYTES + 1 }, 'audio')).toMatch(/limit/);
    expect(mediaProblem({ type: 'application/pdf', size: 10 }, 'audio')).toMatch(/audio format/);
    expect(mediaProblem({ type: 'audio/mpeg', size: 10 }, 'pdf')).toMatch(/isn’t a PDF/);
  });

  it('formats lengths, sizes, names and page numbers', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.9)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    for (const bad of [NaN, Infinity, -4, undefined, '7']) expect(formatDuration(bad)).toBe('0:00');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatSize(25 * 1024 * 1024)).toBe('25 MB');
    expect(nameFromFile('team_standup_2026.mp3', 'Audio')).toBe('team standup 2026');
    expect(nameFromFile('.mp3', 'Audio')).toBe('Audio');
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(2.7, 5)).toBe(2);
    expect(clampPage(NaN, 5)).toBe(1);
    expect(clampPage(4, undefined)).toBe(4);
  });
});

describe('what the file store accepts', () => {
  it('takes audio and PDFs from a peer, still refuses anything else', () => {
    for (const mime of ['application/pdf', 'audio/mpeg', 'audio/webm', 'audio/wav', 'image/png']) expect(() => assertSafeImage({ id: 'ok1', mime }), mime).not.toThrow();
    for (const mime of ['text/html', 'application/javascript', 'audio/webm;codecs=opus', 'video/mp4']) expect(() => assertSafeImage({ id: 'ok1', mime }), mime).toThrow();
    expect(() => assertSafeImage({ id: '../x', mime: 'application/pdf' })).toThrow();
  });

  it('finds the files a page uses, once each', () => {
    const blocks: Block[] = [
      audio('a', 'f1'),
      pdf('p', 'f2'),
      pdf('p2', 'f2'),
      { id: 'i', type: 'image', x: 0, y: 0, w: 1, h: 1, z: 1, imageId: 'f3', aspect: 1 },
      { id: 't', type: 'text', x: 0, y: 0, w: 1, h: 1, z: 1, html: '' },
    ];
    expect(fileIdsOf(blocks)).toEqual(['f1', 'f2', 'f3']);
    expect(fileIdsOf([audio('a', '')])).toEqual([]); // a box whose file never arrived
  });

  it('lets a clip or document be found by name', () => {
    expect(blockText(audio('a', 'f1'))).toBe('Standup');
    const pages = [page('1', 'Meeting', [audio('a', 'f1')]), page('2', 'Legal', [pdf('p', 'f2')]), page('3', 'Plain')];
    expect(searchPages(pages, 'standup').map((p) => p.id)).toEqual(['1']);
    expect(searchPages(pages, 'has:audio').map((p) => p.id)).toEqual(['1']);
    expect(searchPages(pages, 'has:pdf contract').map((p) => p.id)).toEqual(['2']);
  });
});

let laptop: NotesStorage;
let phone: NotesStorage;
/** Wraps a storage so every call runs "on" that device's file system (as in sync.test.ts). */
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
const on = async (name: string) => {
  useDevice(name);
  return onDevice(name, await createTauriStorage());
};
beforeEach(async () => {
  laptop = await on('m-laptop');
  phone = await on('m-phone');
});

describe('audio and PDFs in storage', () => {
  it('keep their bytes and type, and are cleaned up only when nothing uses them', async () => {
    useDevice('m-laptop');
    const a = await laptop.putImage(new Blob([bytes(1, 2, 3)], { type: 'audio/mpeg' }));
    const p = await laptop.putImage(new Blob([bytes(37, 80, 68, 70)], { type: 'application/pdf' }));
    expect((await laptop.sync.readImage(a))?.mime).toBe('audio/mpeg');
    expect((await laptop.sync.readImage(p))?.mime).toBe('application/pdf');
    expect(await laptop.pruneImages(new Set())).toBe(0); // new files get a grace period, in case a save is still on its way
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    try {
      expect(await laptop.pruneImages(new Set([a, p]))).toBe(0);
      expect(await laptop.pruneImages(new Set([p]))).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    expect(await laptop.sync.readImage(a)).toBeNull();
    expect(await laptop.sync.readImage(p)).not.toBeNull();
  });

  it('cross to the other device when syncing, with the page that shows them', async () => {
    useDevice('m-laptop');
    const a = await laptop.putImage(new Blob([bytes(9, 8, 7)], { type: 'audio/webm' }));
    const p = await laptop.putImage(new Blob([bytes(37, 80, 68, 70, 45)], { type: 'application/pdf' }));
    await laptop.savePage(page('pg', 'Meeting', [audio('a', a), pdf('p', p)]));
    const send = <T,>(req: SyncRequest): Promise<T> => handleRequest(laptop.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
    useDevice('m-phone');
    const report = await syncWithLaptop(phone.sync, send);
    expect(report.images).toBe(2);
    const got = (await phone.loadAll()).pages.find((x) => x.id === 'pg');
    expect(got?.blocks.map((b) => b.type)).toEqual(['audio', 'pdf']);
    useDevice('m-laptop');
    const original = await laptop.sync.readImage(a);
    useDevice('m-phone');
    expect((await phone.sync.readImage(a))?.data).toBe(original?.data);
    expect((await phone.sync.readImage(p))?.mime).toBe('application/pdf');
  });

  it('go into a backup and come back, and the backup file is refused when it carries a bad type', async () => {
    useDevice('m-laptop');
    const a = await laptop.putImage(new Blob([bytes(5, 5)], { type: 'audio/ogg' }));
    await laptop.savePage(page('pg', 'Has audio', [audio('a', a)]));
    const backup = await buildBackup(laptop);
    expect(backup.images.map((i) => [i.id, i.mime])).toEqual([[a, 'audio/ogg']]);
    const text = JSON.stringify(backup);
    useDevice('m-phone');
    await restoreBackup(phone, parseBackup(text));
    expect(await phone.sync.readImage(a)).not.toBeNull();
    const evil = JSON.parse(text);
    evil.images[0].mime = 'text/html';
    expect(parseBackup(JSON.stringify(evil)).images).toEqual([]);
  });
});

describe('audio and PDFs in exports and the graph', () => {
  it('write a link when the export carries the file, and just the name when it does not', () => {
    const p = page('1', 'Notes', [audio('a', 'f1', { y: 0 }), pdf('p', 'f2', { y: 200 })]);
    const withFiles = pageToMarkdown(p, () => '', '', (b) => `files/${b.fileId}.bin`);
    expect(withFiles).toContain('🔊 [Standup](files/f1.bin)');
    expect(withFiles).toContain('📄 [Contract](files/f2.bin)');
    const bare = pageToMarkdown(p, () => '');
    expect(bare).toContain('🔊 Standup');
    expect(bare).not.toContain('](');
  });

  it('are stored as files in the graph, searchable by name', async () => {
    const g = await memoryGraph();
    const mirror = new GraphMirror(g.repo);
    await mirror.page({ id: 'pg', title: 'Meeting', groupId: null, tags: [], blocks: [audio('a', 'f1'), pdf('p', 'f2')], arrows: [], created: 5 });
    const rows = await g.repo.listBlocks('pg');
    expect(rows.map((r) => [r.id, r.type, r.plain_text])).toEqual([['a', 'file', 'Standup'], ['p', 'file', 'Contract']]);
    expect(JSON.parse(rows[0].content)).toMatchObject({ kind: 'audio', fileId: 'f1' });
    expect((await mirror.search('standup')).map((h) => h.pageId)).toEqual(['pg']);
  });
});
