import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import type { NotesStorage, PageRecord } from '../src/storage/types';
import { pageToMarkdown } from '../src/export/export';
import { isBlankPage } from '../src/lib/history';
import { liveDrawing, toolToLock, unionBounds } from '../src/lib/drawing';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import type { Page, PageDrawing } from '../src/types';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
const ink = (extra: Partial<PageDrawing> = {}): PageDrawing => ({ scene: '{"elements":[{"id":"e"}]}', preview: SVG, x: -5, y: 20, w: 300, h: 200, ...extra });
const page = (extra: Partial<Page> = {}): Page => ({ id: 'p', title: 'Sketch', groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra });

async function save(s: NotesStorage, p: Page): Promise<Page> {
  const cur = await s.loadPage(p.id);
  const res = await s.savePage({ ...p, rev: cur?.rev ?? p.rev });
  if (!res.ok) throw new Error('conflict');
  return { ...p, rev: res.rev };
}

let laptop: NotesStorage;
let phone: NotesStorage;
beforeEach(async () => {
  useDevice('laptop');
  laptop = await createTauriStorage();
  useDevice('phone');
  phone = await createTauriStorage();
  useDevice('laptop');
});

describe('page drawing', () => {
  it('is saved with the page and read back', async () => {
    await save(laptop, page({ drawing: ink() }));
    expect((await laptop.loadPage('p'))?.drawing).toEqual(ink());
  });

  it('can be cleared again', async () => {
    const saved = await save(laptop, page({ drawing: ink() }));
    await save(laptop, { ...saved, drawing: null });
    expect((await laptop.loadPage('p'))?.drawing).toBeNull();
  });

  it('syncs to the other device, and a purge empties it', async () => {
    await save(laptop, page({ drawing: ink() }));
    const send = <T,>(req: SyncRequest) => handleRequest(laptop.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
    useDevice('phone');
    await syncWithLaptop(phone.sync, send);
    useDevice('phone');
    expect((await phone.loadPage('p'))?.drawing).toEqual(ink());

    useDevice('laptop');
    await laptop.deletePage('p');
    await laptop.purgePage('p');
    const [rec] = (await laptop.sync.getRecords('page', ['p'])) as PageRecord[];
    expect(rec.drawing ?? null).toBeNull();
  });

  it('reads as no drawing from a record sent by an older app version', async () => {
    const old = { id: 'old', etag: 'e1', deleted: false, title: 'Old', groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1 };
    await laptop.sync.applyRemoteIf('page', old as PageRecord, null);
    expect((await laptop.loadPage('old'))?.drawing ?? null).toBeNull();
  });

  it('keeps a page that only has a drawing from counting as blank', () => {
    expect(isBlankPage({ title: '', tags: [], blocks: [], arrows: [], drawing: ink() })).toBe(false);
    expect(isBlankPage({ title: '', tags: [], blocks: [], arrows: [], drawing: null })).toBe(true);
  });

  it('ignores an empty or damaged drawing', () => {
    expect(liveDrawing(null)).toBeNull();
    expect(liveDrawing(ink({ preview: '' }))).toBeNull();
    expect(liveDrawing(ink({ w: 0 }))).toBeNull();
    expect(liveDrawing(ink())).not.toBeNull();
  });

  it('is exported to Markdown as an image link, only when there is a file for it', () => {
    expect(pageToMarkdown(page({ drawing: ink() }), () => '', 'images/drawing.svg')).toContain('![Drawing](images/drawing.svg)');
    expect(pageToMarkdown(page({ drawing: ink() }), () => '')).not.toContain('Drawing');
    expect(pageToMarkdown(page({ drawing: null }), () => '', 'images/drawing.svg')).not.toContain('Drawing');
  });

  it('grows the area a page covers', () => {
    expect(unionBounds([{ x: 0, y: 0, w: 100, h: 50 }, ink()])).toEqual({ minX: -5, minY: 0, maxX: 295, maxY: 220 });
  });
});

describe('keeping the chosen drawing tool', () => {
  it('locks a tool the moment it is picked', () => {
    expect(toolToLock('selection', { type: 'freedraw' })).toBe('freedraw');
    expect(toolToLock('freedraw', { type: 'arrow', locked: false })).toBe('arrow');
  });
  it('does nothing for the pointer tool, an already locked tool, or the same tool again (so unlocking sticks)', () => {
    expect(toolToLock('freedraw', { type: 'selection' })).toBeNull();
    expect(toolToLock('selection', { type: 'rectangle', locked: true })).toBeNull();
    expect(toolToLock('rectangle', { type: 'rectangle', locked: false })).toBeNull();
    expect(toolToLock('selection', { type: 'custom' })).toBeNull();
  });
});
