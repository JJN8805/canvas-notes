// A page holding every kind of box must come back identical from a backup and from a sync, and reading it again must change nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);
vi.mock('../src/components/library/Thumbnail', () => ({ StaticBody: () => null }));

import { createTauriStorage } from '../src/storage/tauri';
import { buildBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import { pageToMarkdown } from '../src/export/export';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import { normalizePage, type NotesStorage } from '../src/storage/types';
import type { Block, Page } from '../src/types';

const g = { x: 0, y: 0, w: 200, h: 60 };
const everything = (imageId: string): Block[] =>
  [
    { id: 'n1', type: 'note', style: 'text', ...g, z: 1, html: '<h1>Title</h1><p>Body with <strong>bold</strong></p>', fill: true, links: [{ page: 'other', block: 'n9' }] },
    { id: 'n2', type: 'note', style: 'sticky', ...g, z: 2, html: '<p>Sticky</p>', tint: 'blue' },
    { id: 'n3', type: 'note', style: 'code', ...g, z: 3, html: '', code: 'const a = "<b>";\nreturn a;' },
    { id: 'c1', type: 'checklist', ...g, z: 4, items: [{ id: 'i1', text: 'Milk', done: true }, { id: 'i2', text: 'Eggs', done: false }] },
    { id: 't1', type: 'table', ...g, z: 5, rows: [['A', 'B'], ['1', '2']] },
    { id: 'f1', type: 'frame', ...g, z: 0, title: 'Frame', color: 'teal', collapsed: false },
    { id: 'im', type: 'image', ...g, z: 6, imageId, aspect: 1.5, alt: 'a picture' },
    { id: 'a1', type: 'audio', ...g, z: 7, fileId: '', name: 'Clip' },
    { id: 'p1', type: 'pdf', ...g, z: 8, fileId: '', name: 'Doc' },
    { id: 'cd', type: 'card', ...g, z: 9, cardId: 'card1' },
  ] as Block[];

const page = (id: string, blocks: Block[]): Page => ({ id, title: 'All kinds', groupId: null, tags: ['t'], blocks, arrows: [], created: 1, updated: 1, rev: 0 });
const strip = (p: Page) => ({ ...p, rev: 0, updated: 0 });

let a: NotesStorage;
let b: NotesStorage;
let imageId = '';

beforeEach(async () => {
  useDevice('a');
  a = await createTauriStorage();
  useDevice('b');
  b = await createTauriStorage();
  useDevice('a');
  imageId = await a.putImage(new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' }));
  await a.savePage(page('p1', everything(imageId)));
});

describe('a page with every kind of box', () => {
  it('is unchanged by reading it again (repair is idempotent)', async () => {
    const p = (await a.loadPage('p1'))!;
    expect(strip(normalizePage(structuredClone(p)))).toEqual(strip(p));
    expect(p.blocks.map((x) => x.id).sort()).toEqual(everything(imageId).map((x) => x.id).sort());
  });
  it('comes back identical from a backup', async () => {
    const original = (await a.loadPage('p1'))!;
    const backup = parseBackup(JSON.stringify(await buildBackup(a)));
    useDevice('b');
    await restoreBackup(b, backup);
    expect(strip((await b.loadPage('p1'))!)).toEqual(strip(original));
  });
  it('comes back identical from a sync', async () => {
    const original = (await a.loadPage('p1'))!;
    const send = <T,>(req: SyncRequest): Promise<T> => handleRequest(a.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
    useDevice('b');
    await syncWithLaptop(b.sync, send);
    expect(strip((await b.loadPage('p1'))!)).toEqual(strip(original));
  });
  it('writes every box into the Markdown export, keeping code exactly', async () => {
    const md = pageToMarkdown((await a.loadPage('p1'))!, (b) => `images/${b.imageId}.png`);
    for (const want of ['Title', 'bold', 'Sticky', 'const a = "<b>";\nreturn a;', 'Milk', 'Eggs', '| A | B |', 'Frame']) expect(md).toContain(want);
    expect(md).toMatch(/```[\s\S]*return a;[\s\S]*```/);
  });
});
