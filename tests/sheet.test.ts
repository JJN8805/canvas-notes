import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);
vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { createTauriStorage } from '../src/storage/tauri';
import { normalizePage, type NotesStorage } from '../src/storage/types';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import { cleanSheet, inkClipPath, inkOnSheet, keepInside, SHEET_LANDSCAPE, SHEET_PORTRAIT, sheetCovering, sheetForContent, taller, wider } from '../src/lib/sheet';
import { createPage, createPageFromTemplate, growPage, mutatePage, saveAsTemplate, setPageSize, updateBlock, useNotes } from '../src/store/notes';
import { history } from '../src/store/history';
import type { Block, Page } from '../src/types';

const base = (extra: Partial<Page>): Page => ({ id: 'x', title: '', groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra });
const box = (id: string, x: number, y: number, w = 200, h = 100): Block => ({ id, type: 'text', x, y, w, h, z: 1, html: '<p>hi</p>' }) as Block;

describe('sheet maths', () => {
  it('accepts a sane sheet and rejects anything else', () => {
    expect(cleanSheet({ x: 0, y: 0, w: 1240, h: 1754 })).toEqual({ x: 0, y: 0, w: 1240, h: 1754 });
    for (const bad of [null, undefined, 3, 'a', {}, { x: 0, y: 0, w: 10, h: 1000 }, { x: 0, y: 0, w: 1e9, h: 1000 }, { x: NaN, y: 0, w: 900, h: 900 }, { x: 0, y: 0, w: '900', h: 900 }, { x: 1e12, y: 0, w: 900, h: 900 }]) {
      expect(cleanSheet(bad)).toBeNull();
    }
  });

  it('grows to cover boxes, never shrinks, and keeps the page infinite-safe when boxes are absurdly far apart', () => {
    expect(sheetCovering(SHEET_PORTRAIT, [box('a', 10, 10)])).toEqual(SHEET_PORTRAIT);
    expect(sheetCovering(SHEET_PORTRAIT, [box('a', 1300, 10)])).toMatchObject({ x: 0, w: 1500 });
    expect(sheetCovering(SHEET_PORTRAIT, [box('a', -100, -50)])).toMatchObject({ x: -100, y: -50, w: 1340, h: 1804 });
    expect(sheetCovering(SHEET_PORTRAIT, [box('a', 0, 0, 90000, 10)])).toEqual(SHEET_PORTRAIT); // over the limit: left as it was
    expect(sheetCovering(SHEET_PORTRAIT, [{ x: NaN, y: 0, w: 1, h: 1 }])).toEqual(SHEET_PORTRAIT);
  });

  it('pulls a box inside, shrinking it only when it is bigger than the sheet', () => {
    const s = { x: 100, y: 100, w: 500, h: 400 };
    const a = box('a', 0, 0);
    keepInside(a, s);
    expect(a).toMatchObject({ x: 100, y: 100 });
    const b = box('b', 550, 450);
    keepInside(b, s);
    expect(b).toMatchObject({ x: 400, y: 400 });
    const c = box('c', 120, 120, 900, 900);
    keepInside(c, s);
    expect(c).toMatchObject({ x: 100, y: 100, w: 500, h: 400 });
    const ok = box('d', 150, 150);
    keepInside(ok, s);
    expect(ok).toMatchObject({ x: 150, y: 150, w: 200, h: 100 });
  });

  it('adds room below or to the right', () => {
    expect(taller(SHEET_PORTRAIT).h).toBeGreaterThan(SHEET_PORTRAIT.h);
    expect(wider(SHEET_PORTRAIT).w).toBeGreaterThan(SHEET_PORTRAIT.w);
    expect(taller({ x: 0, y: 0, w: 900, h: 19900 }).h).toBe(19900); // at the limit
    expect(sheetForContent([])).toEqual(SHEET_PORTRAIT);
  });
});

describe('ink on a sheet', () => {
  const s = { x: 0, y: 0, w: 1000, h: 1000 };
  it('shows the whole drawing on an infinite page, the overlap on a sheet, nothing when it lies outside', () => {
    expect(inkOnSheet({ x: 5000, y: 5000, w: 10, h: 10 }, null)).toEqual({ x: 5000, y: 5000, w: 10, h: 10 });
    expect(inkOnSheet({ x: 900, y: 900, w: 300, h: 300 }, s)).toEqual({ x: 900, y: 900, w: 100, h: 100 });
    expect(inkOnSheet({ x: -50, y: 10, w: 100, h: 20 }, s)).toEqual({ x: 0, y: 10, w: 50, h: 20 });
    expect(inkOnSheet({ x: 1000, y: 0, w: 50, h: 50 }, s)).toBeNull();
    expect(inkOnSheet({ x: 2000, y: 2000, w: 50, h: 50 }, s)).toBeNull();
  });
  it('clips with the same overlap', () => {
    expect(inkClipPath({ x: 900, y: 900, w: 300, h: 300 }, s)).toBe('inset(0px 200px 200px 0px)');
    expect(inkClipPath({ x: -50, y: 10, w: 100, h: 20 }, s)).toBe('inset(0px 0px 0px 50px)');
  });
});

describe('pages in the store', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useNotes.setState({ filter: { kind: 'all' }, pages: {} });
  });
  afterEach(() => vi.restoreAllMocks());

  it('a new page is finite', () => {
    expect(createPage().sheet).toEqual(SHEET_PORTRAIT);
  });

  it('a new page that starts with wide content gets a sheet that holds it', () => {
    const p = createPage({ blocks: [box('a', 1500, 20)] });
    expect(p.sheet!.x + p.sheet!.w).toBeGreaterThanOrEqual(1700);
  });

  it('sheet: null asks for an infinite page, and a nonsense sheet becomes infinite', () => {
    expect(createPage({ sheet: null }).sheet).toBeNull();
    expect(createPage({ sheet: { x: 0, y: 0, w: 1, h: 1 } }).sheet).toBeNull();
  });

  it('cards have no sheet', () => {
    expect(createPage({ kind: 'card' }).sheet).toBeNull();
  });

  it('a box can be dragged to the edge but never past it, whatever way the change is made', () => {
    const p = createPage({ blocks: [box('a', 100, 100)] });
    history.clear(p.id);
    updateBlock(p.id, 'a', (b) => void Object.assign(b, { x: -500, y: 99999 }));
    const a = useNotes.getState().pages[p.id].blocks[0];
    expect(a.x).toBe(0);
    expect(a.y + a.h).toBe(SHEET_PORTRAIT.h);
    // a block added through a plain mutation (paste, the assistant, an import) is pulled in as well
    mutatePage(p.id, (d) => void d.blocks.push(box('b', 5000, -40)));
    const b = useNotes.getState().pages[p.id].blocks.find((x) => x.id === 'b')!;
    expect(b.x + b.w).toBe(SHEET_PORTRAIT.w);
    expect(b.y).toBe(0);
  });

  it('a box that has grown with its text is kept inside by its grown height', () => {
    const p = createPage({ blocks: [{ ...box('a', 100, 100, 200, 40), ah: 300 } as Block] });
    updateBlock(p.id, 'a', (b) => void Object.assign(b, { y: 99999 }));
    const a = useNotes.getState().pages[p.id].blocks[0];
    expect(a.y + 300).toBe(SHEET_PORTRAIT.h);
    expect(a.h).toBe(40);
  });

  it('an infinite page lets boxes go anywhere', () => {
    const p = createPage({ sheet: null, blocks: [box('a', 0, 0)] });
    updateBlock(p.id, 'a', (b) => void Object.assign(b, { x: -5000, y: 9000 }));
    expect(useNotes.getState().pages[p.id].blocks[0]).toMatchObject({ x: -5000, y: 9000 });
  });

  it('making a page infinite and back to finite keeps every box where it was', () => {
    const p = createPage({ sheet: null, blocks: [box('a', -300, 50), box('b', 4000, 3000)] });
    setPageSize(p.id, 'portrait');
    const s = useNotes.getState().pages[p.id].sheet!;
    expect(s).toMatchObject({ x: -300, y: 0 });
    expect(s.x + s.w).toBeGreaterThanOrEqual(4200);
    expect(s.y + s.h).toBeGreaterThanOrEqual(3100);
    expect(useNotes.getState().pages[p.id].blocks.map((b) => [b.x, b.y])).toEqual([[-300, 50], [4000, 3000]]);
    setPageSize(p.id, 'infinite');
    expect(useNotes.getState().pages[p.id].sheet).toBeNull();
  });

  it('portrait and landscape swap the shape and keep the corner; add-room buttons grow it', () => {
    const p = createPage();
    setPageSize(p.id, 'landscape');
    expect(useNotes.getState().pages[p.id].sheet).toEqual(SHEET_LANDSCAPE);
    growPage(p.id, 'down');
    expect(useNotes.getState().pages[p.id].sheet!.h).toBeGreaterThan(SHEET_LANDSCAPE.h);
    growPage(p.id, 'right');
    expect(useNotes.getState().pages[p.id].sheet!.w).toBeGreaterThan(SHEET_LANDSCAPE.w);
    // no-op on an infinite page
    const q = createPage({ sheet: null });
    growPage(q.id, 'down');
    expect(useNotes.getState().pages[q.id].sheet).toBeNull();
  });

  it('a page made from a template takes the template’s sheet, or fits an old template’s contents', () => {
    useNotes.setState({
      pages: {
        wide: base({ id: 'wide', kind: 'template', title: 'Wide', sheet: SHEET_LANDSCAPE }),
        old: base({ id: 'old', kind: 'template', title: 'Old', blocks: [box('a', 2000, 10)] }),
      },
    });
    expect(createPageFromTemplate('wide')!.sheet).toEqual(SHEET_LANDSCAPE);
    const fromOld = createPageFromTemplate('old')!;
    expect(fromOld.sheet).not.toBeNull();
    expect(fromOld.sheet!.x + fromOld.sheet!.w).toBeGreaterThanOrEqual(2200);
  });

  it('a template remembers its page’s sheet', () => {
    const p = createPage({ title: 'Landscape plan' });
    setPageSize(p.id, 'landscape');
    expect(saveAsTemplate(p.id, 'T')!.sheet).toEqual(SHEET_LANDSCAPE);
  });
});

describe('reading old or odd data', () => {
  it('a page without a sheet stays infinite', () => {
    expect(normalizePage({ id: 'a', blocks: [box('b', -9000, 9000)] }).sheet).toBeNull();
  });
  it('a stored sheet is grown to hold boxes another app version put outside it', () => {
    const p = normalizePage({ id: 'a', sheet: { x: 0, y: 0, w: 800, h: 800 }, blocks: [box('b', 900, 10)] });
    expect(p.sheet!.w).toBeGreaterThanOrEqual(1100);
  });
  it('garbage becomes infinite', () => {
    expect(normalizePage({ id: 'a', sheet: 'lots' as never }).sheet).toBeNull();
    expect(normalizePage({ id: 'a', sheet: { x: 0, y: 0, w: -1, h: 5 } as never }).sheet).toBeNull();
  });
});

describe('stored and synced between two devices', () => {
  let laptop: NotesStorage;
  let phone: NotesStorage;
  beforeEach(async () => {
    useDevice('laptop');
    laptop = await createTauriStorage();
    useDevice('phone');
    phone = await createTauriStorage();
  });
  const send = <T,>(req: SyncRequest) => {
    useDevice('laptop');
    return handleRequest(laptop.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
  };

  it('keeps a page’s sheet through save and load, and an infinite page stays infinite', async () => {
    useDevice('laptop');
    await laptop.savePage(base({ id: 'f', sheet: SHEET_LANDSCAPE }));
    await laptop.savePage(base({ id: 'i', sheet: null }));
    expect((await laptop.loadPage('f'))!.sheet).toEqual(SHEET_LANDSCAPE);
    expect((await laptop.loadPage('i'))!.sheet).toBeNull();
    await laptop.savePage({ ...(await laptop.loadPage('f'))!, sheet: null });
    expect((await laptop.loadPage('f'))!.sheet).toBeNull();
  });

  it('reaches the other device, including a later change of size', async () => {
    useDevice('laptop');
    await laptop.savePage(base({ id: 'f', title: 'Sheet', sheet: SHEET_PORTRAIT }));
    useDevice('phone');
    await syncWithLaptop(phone.sync, send);
    expect((await phone.loadPage('f'))!.sheet).toEqual(SHEET_PORTRAIT);

    useDevice('laptop');
    await laptop.savePage({ ...(await laptop.loadPage('f'))!, sheet: SHEET_LANDSCAPE });
    useDevice('phone');
    await syncWithLaptop(phone.sync, send);
    expect((await phone.loadPage('f'))!.sheet).toEqual(SHEET_LANDSCAPE);

    useDevice('laptop');
    await laptop.savePage({ ...(await laptop.loadPage('f'))!, sheet: null });
    useDevice('phone');
    await syncWithLaptop(phone.sync, send);
    expect((await phone.loadPage('f'))!.sheet).toBeNull();
  });

  it('a conflicted copy keeps the sheet', async () => {
    useDevice('laptop');
    await laptop.savePage(base({ id: 'f', title: 'One', sheet: SHEET_LANDSCAPE }));
    useDevice('phone');
    await syncWithLaptop(phone.sync, send);
    useDevice('laptop');
    await laptop.savePage({ ...(await laptop.loadPage('f'))!, title: 'Laptop edit' });
    useDevice('phone');
    await phone.savePage({ ...(await phone.loadPage('f'))!, title: 'Phone edit' });
    await syncWithLaptop(phone.sync, send);
    const all = (await phone.loadAll()).pages;
    expect(all.length).toBe(2);
    expect(all.every((p) => p.sheet?.w === SHEET_LANDSCAPE.w)).toBe(true);
  });

  it('upgrades a database from before finite pages: every page stays infinite, and a sheet can then be saved', async () => {
    const old = new FakeDatabase();
    old.db.exec(`CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', group_id TEXT, tags TEXT NOT NULL DEFAULT '[]',
      blocks TEXT NOT NULL DEFAULT '[]', arrows TEXT NOT NULL DEFAULT '[]', drawing TEXT NOT NULL DEFAULT '', color TEXT, kind TEXT NOT NULL DEFAULT 'page', daily_date TEXT,
      created INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0, etag TEXT, synced TEXT, deleted INTEGER NOT NULL DEFAULT 0)`);
    old.db.exec(`INSERT INTO pages (id, title, blocks, etag, rev) VALUES ('keep', 'Kept', '[{"id":"b","type":"text","x":-4000,"y":7000,"w":200,"h":80,"z":1,"html":"<p>far</p>"}]', 'e1', 1)`);
    old.db.exec('PRAGMA user_version = 9');
    old.db.exec(`CREATE TABLE page_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'teal', position INTEGER NOT NULL DEFAULT 0, etag TEXT, synced TEXT, deleted INTEGER NOT NULL DEFAULT 0, parent_id TEXT)`);
    old.db.exec(`CREATE TABLE images (id TEXT PRIMARY KEY, file TEXT, mime TEXT, created INTEGER)`);
    old.db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    old.db.exec(`CREATE TABLE page_snapshots (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, taken INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', blocks TEXT NOT NULL, arrows TEXT NOT NULL DEFAULT '[]')`);
    useDevice('upgraded');
    FakeDatabase.next = old;
    const s = await createTauriStorage();
    const p = await s.loadPage('keep');
    expect(p!.sheet).toBeNull();
    expect(p!.blocks[0]).toMatchObject({ x: -4000, y: 7000 }); // nothing moved
    await s.savePage({ ...p!, sheet: SHEET_PORTRAIT });
    expect((await s.loadPage('keep'))!.sheet!.w).toBeGreaterThanOrEqual(SHEET_PORTRAIT.w);
  });
});
