import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { normalizePage, type NotesStorage, type PageRecord } from '../src/storage/types';
import { applyColor, cleanColor, colorOf, frameInk, tintVars } from '../src/lib/colors';
import { colorVar } from '../src/lib/util';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import { history } from '../src/store/history';
import { useNotes, setColor, setPageColor, undo, redo } from '../src/store/notes';
import { NOTE_COLORS, type Block, type Page } from '../src/types';

const text = (id: string, extra: Partial<Block> = {}) => ({ id, type: 'text', x: 0, y: 0, w: 200, h: 40, z: 1, html: '<p>x</p>', ...extra }) as Block;
const frame = (id: string, color: string = 'teal') => ({ id, type: 'frame', x: 0, y: 0, w: 300, h: 200, z: 0, title: 'F', color, collapsed: false }) as Block;
const image = (id: string) => ({ id, type: 'image', x: 0, y: 0, w: 100, h: 100, z: 1, imageId: 'i', aspect: 1 }) as Block;
const page = (extra: Partial<Page> = {}): Page => ({ id: 'p', title: 'T', groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra });

describe('colour logic', () => {
  it('tints ordinary boxes and images, and recolours frames', () => {
    const blocks = [text('a'), image('b'), frame('f')];
    expect(applyColor(blocks, ['a', 'b', 'f'], 'blue')).toBe(true);
    expect(blocks.map(colorOf)).toEqual(['blue', 'blue', 'blue']);
    expect((blocks[0] as { tint?: string }).tint).toBe('blue');
    expect((blocks[2] as { color: string }).color).toBe('blue');
  });

  it('"none" removes a tint and sends a frame back to slate', () => {
    const blocks = [text('a', { tint: 'red' }), frame('f', 'pink')];
    expect(applyColor(blocks, ['a', 'f'], null)).toBe(true);
    expect(blocks[0]).not.toHaveProperty('tint');
    expect((blocks[1] as { color: string }).color).toBe('slate');
  });

  it('reports no change when the boxes already have the colour, and leaves others alone', () => {
    const blocks = [text('a', { tint: 'green' }), text('b', { tint: 'red' })];
    expect(applyColor(blocks, ['a'], 'green')).toBe(false);
    expect(applyColor(blocks, ['a'], null)).toBe(true);
    expect(colorOf(blocks[1])).toBe('red');
  });

  it('treats unknown stored colours as none, and frames in the old palette as no note colour', () => {
    expect(cleanColor('mauve')).toBeNull();
    expect(cleanColor('gray')).toBe('gray');
    expect(colorOf(text('a', { tint: 'mauve' as never }))).toBeNull();
    expect(colorOf(frame('f', 'teal'))).toBeNull();
    expect(normalizePage({ id: 'x', color: 'mauve' as never }).color).toBeNull();
  });

  it('colorVar knows both palettes', () => {
    expect(colorVar('yellow')).toBe('var(--n-yellow)');
    expect(colorVar('teal')).toBe('var(--c-teal)');
  });
});

describe('colour tokens', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  const light = css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)'));
  const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('*, *::before'));
  const token = (block: string, name: string) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  for (const [theme, block] of [['light', light], ['dark', dark]] as const) {
    it(`defines all ${NOTE_COLORS.length} colours with readable text in the ${theme} theme`, () => {
      for (const c of NOTE_COLORS) {
        const bg = token(block, `n-${c}`);
        const ink = token(block, `n-${c}-ink`);
        expect(bg, `${c} background`).toBeDefined();
        expect(ink, `${c} text`).toBeDefined();
        expect(contrast(bg!, ink!), `${c} contrast`).toBeGreaterThanOrEqual(7);
      }
    });
  }
});

describe('colour and the undo history', () => {
  beforeEach(() => {
    // The store schedules a save with window.setTimeout; there is no storage behind it in this test.
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    history.clear('p');
    useNotes.setState({ pages: { p: page({ blocks: [text('a'), text('b'), frame('f')] }) } });
  });

  const tints = () => useNotes.getState().pages.p.blocks.map(colorOf);

  it('colours several boxes as one undo step', () => {
    setColor('p', ['a', 'b', 'f'], 'purple');
    expect(tints()).toEqual(['purple', 'purple', 'purple']);
    expect(undo('p')).toBe(true);
    expect(tints()).toEqual([null, null, null]);
    expect(redo('p')).toBe(true);
    expect(tints()).toEqual(['purple', 'purple', 'purple']);
  });

  it('marks the page as changed, so it syncs', () => {
    const before = useNotes.getState().pages.p.updated;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(before + 5000);
    setColor('p', ['a'], 'gray');
    vi.useRealTimers();
    expect(useNotes.getState().pages.p.updated).toBeGreaterThan(before);
  });

  it('records no undo step when nothing changes', () => {
    setColor('p', ['a'], 'red');
    setColor('p', ['a'], 'red');
    expect(undo('p')).toBe(true);
    expect(tints()[0]).toBeNull();
    expect(undo('p')).toBe(false);
  });

  it('sets a page card colour without touching the canvas undo history', () => {
    setPageColor('p', 'orange');
    expect(useNotes.getState().pages.p.color).toBe('orange');
    expect(undo('p')).toBe(false);
    setPageColor('p', null);
    expect(useNotes.getState().pages.p.color).toBeNull();
  });
});

describe('colour storage and sync', () => {
  let laptop: NotesStorage;
  let phone: NotesStorage;
  beforeEach(async () => {
    useDevice('laptop');
    laptop = await createTauriStorage();
    useDevice('phone');
    phone = await createTauriStorage();
    useDevice('laptop');
  });
  const save = async (s: NotesStorage, p: Page) => {
    const cur = await s.loadPage(p.id);
    const res = await s.savePage({ ...p, rev: cur?.rev ?? p.rev });
    if (!res.ok) throw new Error('conflict');
    return { ...p, rev: res.rev };
  };

  it('saves block tints and the page colour, and reads them back', async () => {
    await save(laptop, page({ color: 'pink', blocks: [text('a', { tint: 'blue' }), frame('f', 'yellow')] }));
    const back = await laptop.loadPage('p');
    expect(back?.color).toBe('pink');
    expect(back?.blocks.map(colorOf)).toEqual(['blue', 'yellow']);
    const saved = await save(laptop, { ...page(), color: 'pink' });
    await save(laptop, { ...saved, color: null });
    expect((await laptop.loadPage('p'))?.color).toBeNull();
  });

  it('upgrades a database from before page colours without changing its pages', async () => {
    // A database stopped at schema v7: the pages table has no colour column yet.
    const old = new FakeDatabase();
    old.db.exec(`CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', group_id TEXT, tags TEXT NOT NULL DEFAULT '[]',
      blocks TEXT NOT NULL DEFAULT '[]', arrows TEXT NOT NULL DEFAULT '[]', drawing TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0, etag TEXT, synced TEXT, deleted INTEGER NOT NULL DEFAULT 0)`);
    old.db.exec(`INSERT INTO pages (id, title, blocks, etag, rev) VALUES ('keep', 'Kept', '[{"id":"a","type":"text","x":0,"y":0,"w":9,"h":9,"z":1,"html":"<p>hi</p>"}]', 'e1', 1)`);
    const rows = old.db.prepare('PRAGMA table_info(pages)').all() as { name: string }[];
    expect(rows.map((r) => r.name)).not.toContain('color');
    old.db.exec('PRAGMA user_version = 7');
    old.db.exec(`CREATE TABLE page_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'teal', position INTEGER NOT NULL DEFAULT 0, etag TEXT, synced TEXT, deleted INTEGER NOT NULL DEFAULT 0, parent_id TEXT)`);
    old.db.exec(`CREATE TABLE images (id TEXT PRIMARY KEY, file TEXT, mime TEXT, created INTEGER)`);
    old.db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    old.db.exec(`CREATE TABLE page_snapshots (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, taken INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', blocks TEXT NOT NULL, arrows TEXT NOT NULL DEFAULT '[]')`);
    useDevice('upgraded');
    FakeDatabase.next = old;
    const s = await createTauriStorage();
    const p = await s.loadPage('keep');
    expect(p?.title).toBe('Kept');
    expect(p?.blocks).toHaveLength(1);
    expect(p?.color).toBeNull();
    expect(p?.blocks[0]).not.toHaveProperty('tint');
    await save(s, { ...p!, color: 'green' });
    expect((await s.loadPage('keep'))?.color).toBe('green');
  });

  it('syncs colours to the other device', async () => {
    await save(laptop, page({ color: 'purple', blocks: [text('a', { tint: 'red' })] }));
    const send = <T,>(req: SyncRequest) => handleRequest(laptop.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
    useDevice('phone');
    await syncWithLaptop(phone.sync, send);
    useDevice('phone');
    const got = await phone.loadPage('p');
    expect(got?.color).toBe('purple');
    expect(got?.blocks.map(colorOf)).toEqual(['red']);
  });

  it('reads a record from an older app version (no colour) as having none', async () => {
    const old = { id: 'old', etag: 'e1', deleted: false, title: 'Old', groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1 };
    await laptop.sync.applyRemoteIf('page', old as PageRecord, null);
    expect((await laptop.loadPage('old'))?.color ?? null).toBeNull();
  });
});

describe('colour on every kind of box', () => {
  const all = (): Block[] => [
    text('t'),
    { id: 'c', type: 'checklist', x: 0, y: 0, w: 100, h: 40, z: 1, items: [] } as Block,
    { id: 'k', type: 'code', x: 0, y: 0, w: 100, h: 40, z: 1, code: '' } as Block,
    { id: 'tb', type: 'table', x: 0, y: 0, w: 100, h: 40, z: 1, rows: [['a']] } as Block,
    image('i'),
    { id: 's', type: 'sticky', x: 0, y: 0, w: 200, h: 200, z: 1, html: '' } as Block,
    frame('f'),
  ];
  const ids = all().map((b) => b.id);

  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    history.clear('p');
    useNotes.setState({ pages: { p: page({ blocks: all() }) } });
  });

  it('recolours text, list, code, table, picture, sticky and frame boxes in one undo step', () => {
    setColor('p', ids, 'green');
    expect(useNotes.getState().pages.p.blocks.map(colorOf)).toEqual(ids.map(() => 'green'));
    undo('p');
    expect(useNotes.getState().pages.p.blocks.map(colorOf)).toEqual(ids.map(() => null));
  });

  it('takes a frame back to slate for "none", which is no note colour', () => {
    setColor('p', ['f'], 'pink');
    setColor('p', ['f'], null);
    const f = useNotes.getState().pages.p.blocks.find((b) => b.id === 'f') as { color: string };
    expect(f.color).toBe('slate');
    expect(colorOf(useNotes.getState().pages.p.blocks.find((b) => b.id === 'f')!)).toBeNull();
  });

  it('gives a tinted box the variables the stylesheet reads, and a frame header readable text', () => {
    const v = tintVars({ ...text('t'), tint: 'blue' } as Block)!;
    expect(Object.keys(v).sort()).toEqual(['--tint', '--tint-head', '--tint-ink', '--tint-soft']);
    expect(frameInk('blue')).toBe('var(--n-blue-ink)');
    expect(frameInk('teal')).toBeNull();
  });

  it('is drawn by the stylesheet for each kind of box, falling back to the old look without a colour', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    for (const rule of [
      /\.b-text \.body \{[^}]*var\(--tint, transparent\)/,
      /\.b-checklist \.body \{[^}]*var\(--tint, var\(--sheet\)\)/,
      /\.b-code \.body \{[^}]*var\(--tint, var\(--code-bg\)\)/,
      /\.b-table \.body \{[^}]*var\(--tint, var\(--sheet\)\)/,
      /\.b-image img \{[^}]*var\(--tint, transparent\)/,
      /\.b-sticky \{[^}]*var\(--tint, var\(--sheet\)\)/,
    ]) expect(css).toMatch(rule);
  });
});

describe('page card colour', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    history.clear('p');
    useNotes.setState({ pages: { p: page() } });
  });

  it('is set, changed and cleared, and a repeat does nothing', () => {
    setPageColor('p', 'blue');
    const stamp = useNotes.getState().pages.p.updated;
    setPageColor('p', 'blue');
    expect(useNotes.getState().pages.p.updated).toBe(stamp);
    setPageColor('p', null);
    expect(useNotes.getState().pages.p.color).toBeNull();
  });

  it('is drawn on the card as a left stripe and a soft tint', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toMatch(/\.card\.colored \{[^}]*inset 6px 0 0 var\(--pc\)/);
    expect(css).toMatch(/\.card\.colored \.card-body \{[^}]*var\(--pc\)/);
  });
});
