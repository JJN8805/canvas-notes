import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, fsRoots, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { GRAPH_SCHEMA } from './fixtures/oldGraphSchema';

/** A database as the app made it just before cards' covers were stored: all tables, the old graph copy, plain pictures and full-copy history. */
function oldInstall(): FakeDatabase {
  const old = new FakeDatabase();
  const x = (sql: string) => old.db.exec(sql);
  x(`CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', group_id TEXT, tags TEXT NOT NULL DEFAULT '[]', blocks TEXT NOT NULL DEFAULT '[]', arrows TEXT NOT NULL DEFAULT '[]', drawing TEXT NOT NULL DEFAULT '', color TEXT, kind TEXT NOT NULL DEFAULT 'page', daily_date TEXT, sheet TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0, etag TEXT, synced TEXT, deleted INTEGER NOT NULL DEFAULT 0)`);
  x(`CREATE TABLE page_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'teal', position INTEGER NOT NULL DEFAULT 0, etag TEXT, synced TEXT, deleted INTEGER NOT NULL DEFAULT 0, parent_id TEXT, scope TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '')`);
  x(`CREATE TABLE images (id TEXT PRIMARY KEY, file TEXT, mime TEXT, created INTEGER)`);
  x(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  x(`CREATE TABLE page_snapshots (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, taken INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', blocks TEXT NOT NULL, arrows TEXT NOT NULL DEFAULT '[]')`);
  for (const sql of GRAPH_SCHEMA) x(sql); // the second copy of every page, as installs have it
  x('PRAGMA user_version = 13');
  const blocks = JSON.stringify([
    { id: 'b1', type: 'note', style: 'text', x: 0, y: 0, w: 200, h: 40, z: 1, html: '<p>Hello [[Other]] world</p>' },
    { id: 'b2', type: 'image', x: 0, y: 60, w: 100, h: 100, z: 2, imageId: 'imgA', aspect: 1 },
  ]);
  x(`INSERT INTO pages (id, title, blocks, etag, rev, created, updated) VALUES ('p1', 'First', '${blocks.replace(/'/g, "''")}', 'e1', 1, 1, 1)`);
  x(`INSERT INTO pages (id, title, blocks, etag, rev, created, updated) VALUES ('p2', 'Other', '[]', 'e2', 1, 2, 2)`);
  // the graph copy of those pages
  x(`INSERT INTO nodes (id, type, title, created_at, updated_at, device_id) VALUES ('p1', 'page', 'First', 1, 1, 'dev')`);
  x(`INSERT INTO nodes (id, type, title, created_at, updated_at, device_id) VALUES ('p2', 'page', 'Other', 2, 2, 'dev')`);
  x(`INSERT INTO edges (id, src, dst, type, created_at, updated_at, device_id) VALUES ('e', 'p1', 'p2', 'LINKS_TO', 1, 1, 'dev')`);
  x(`INSERT INTO blocks (id, page_id, type, x, y, w, h, z, content, plain_text, created_at, updated_at, device_id) VALUES ('b1', 'p1', 'text', 0, 0, 200, 40, 1, '{"html":"x"}', 'Hello [[Other]] world', 1, 1, 'dev')`);
  x(`INSERT INTO settings (key, value) VALUES ('graph_device_id', 'dev'), ('graph_imported_at', '123'), ('keep.me', 'yes')`);
  // pictures: three files that are really one, as repeated adds made them
  x(`INSERT INTO images (id, file, mime, created) VALUES ('imgA', 'imgA.png', 'image/png', 1), ('imgB', 'imgB.png', 'image/png', 1), ('imgC', 'imgC.png', 'image/png', 1)`);
  // history written out in full
  const v = (n: number) => JSON.stringify([{ id: 'b1', type: 'note', style: 'text', x: 0, y: 0, w: 200, h: 40, z: 1, html: `<p>version ${n}</p>` }, { id: 'b2', type: 'note', style: 'text', x: 0, y: 60, w: 200, h: 40, z: 2, html: '<p>never changes</p>' }]);
  for (let i = 1; i <= 3; i++) x(`INSERT INTO page_snapshots (id, page_id, taken, title, blocks, arrows) VALUES ('s${i}', 'p1', ${1000 + i}, 'First', '${v(i)}', '[]')`);
  return old;
}
const tables = (db: FakeDatabase) => (db.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view','trigger')").all() as { name: string }[]).map((r) => r.name);

beforeEach(() => {
  fsRoots.clear();
  useDevice('upgraded');
});

describe('upgrading an existing install', () => {
  it('removes the graph tables (the second and third copies) and nothing else', async () => {
    const old = oldInstall();
    expect(tables(old)).toEqual(expect.arrayContaining(['nodes', 'edges', 'blocks', 'search_blocks', 'v_backlinks', 'blocks_fts_ai']));
    FakeDatabase.next = old;
    await createTauriStorage();
    const left = tables(old);
    for (const gone of ['nodes', 'edges', 'blocks', 'connectors', 'assets', 'devices', 'sync_peers', 'search_blocks', 'search_nodes', 'v_backlinks', 'v_page_tags', 'v_tag_counts', 'v_orphan_pages', 'blocks_fts_ai', 'nodes_fts_ad']) expect(left, gone).not.toContain(gone);
    for (const kept of ['pages', 'page_groups', 'images', 'settings', 'page_snapshots', 'history_blocks']) expect(left, kept).toContain(kept);
    expect((old.db.prepare("SELECT value FROM settings WHERE key = 'keep.me'").get() as { value: string }).value).toBe('yes');
    expect(old.db.prepare("SELECT COUNT(*) n FROM settings WHERE key LIKE 'graph_%'").get()).toEqual({ n: 0 });
  });

  it('leaves every page exactly as it was', async () => {
    const old = oldInstall();
    FakeDatabase.next = old;
    const s = await createTauriStorage();
    const { pages } = await s.loadAll();
    expect(pages.map((p) => p.title).sort()).toEqual(['First', 'Other']);
    const first = pages.find((p) => p.id === 'p1')!;
    expect(first.blocks).toHaveLength(2);
    expect(first.blocks[0]).toMatchObject({ type: 'note', style: 'text', html: '<p>Hello [[Other]] world</p>' });
  });

  it('then merges the duplicate pictures and converts the old history, keeping both readable', async () => {
    const old = oldInstall();
    for (const id of ['imgA', 'imgB', 'imgC']) fsRoots.get('upgraded')!.set(`images/${id}.png`, new Uint8Array(3000).fill(5));
    FakeDatabase.next = old;
    const s = await createTauriStorage();
    expect((await s.report()).pending).toBeGreaterThan(0);
    const r = await s.tidy();
    expect(r).toMatchObject({ filesMerged: 2, bytesFreed: 6000, versionsConverted: 3 });
    expect([...fsRoots.get('upgraded')!.keys()].filter((k) => k.includes('images/'))).toHaveLength(1);
    for (const id of ['imgA', 'imgB', 'imgC']) expect(await s.sync.readImage(id)).not.toBeNull(); // the page that names imgA still shows it
    const versions = await s.listSnapshots('p1');
    expect(versions.map((v) => (v.blocks[0] as { html: string }).html)).toEqual(['<p>version 3</p>', '<p>version 2</p>', '<p>version 1</p>']);
    expect(old.db.prepare('SELECT COUNT(*) n FROM history_blocks').get()).toEqual({ n: 4 }); // four distinct boxes, not six
    expect(await s.report()).toMatchObject({ pending: 0, files: 1, fileUses: 3, versions: 3 });
  });

  it('works on a fresh install too, which never had the graph', async () => {
    const s = await createTauriStorage();
    const id = await s.putImage(new Blob([new Uint8Array(10).fill(1)], { type: 'image/png' }));
    expect(id).toBeTruthy();
    expect(await s.report()).toMatchObject({ pages: 0, files: 1, pending: 0 });
  });
});
