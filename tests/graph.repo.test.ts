import { beforeEach, describe, expect, it } from 'vitest';
import { memoryGraph } from './graphdb';
import { edgeId, uuidv5 } from '../src/graph/uuid';
import type { GraphRepo } from '../src/graph/repo';

let repo: GraphRepo;
let sqlite: Awaited<ReturnType<typeof memoryGraph>>['sqlite'];
beforeEach(async () => {
  ({ repo, sqlite } = await memoryGraph());
});

const page = (id: string, title = id) => repo.createNode({ id, type: 'page', title });

describe('uuid', () => {
  it('matches the RFC 4122 v5 reference vector', async () => {
    // uuid5(NAMESPACE_DNS, "www.example.com")
    expect(await uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
  it('is deterministic per src|dst|type and differs when any part differs', async () => {
    expect(await edgeId('a', 'b', 'LINKS_TO')).toBe(await edgeId('a', 'b', 'LINKS_TO'));
    expect(await edgeId('a', 'b', 'LINKS_TO')).not.toBe(await edgeId('b', 'a', 'LINKS_TO'));
    expect(await edgeId('a', 'b', 'LINKS_TO')).not.toBe(await edgeId('a', 'b', 'RELATED'));
  });
});

describe('nodes', () => {
  it('creates, reads, updates and lists, stamping updated_at and device_id', async () => {
    const n = await repo.createNode({ id: 'p1', type: 'page', title: 'Hello', color: 'teal', props: { a: 1 } });
    expect(n).toMatchObject({ id: 'p1', type: 'page', title: 'Hello', color: 'teal', props: '{"a":1}', device_id: 'dev-A', deleted_at: null });
    const u = await repo.updateNode('p1', { title: 'Renamed' });
    expect(u.title).toBe('Renamed');
    expect(u.updated_at).toBeGreaterThan(n.updated_at);
    expect(u.created_at).toBe(n.created_at);
    expect((await repo.listNodes('page')).map((x) => x.title)).toEqual(['Renamed']);
  });

  it('records the writing device', async () => {
    const other = await memoryGraph('dev-B');
    expect((await other.repo.createNode({ type: 'tag', title: 'x' })).device_id).toBe('dev-B');
  });

  it('does not touch updated_at when nothing changed', async () => {
    const n = await page('p1', 'Same');
    const again = await repo.putNode({ id: 'p1', type: 'page', title: 'Same' });
    expect(again.updated_at).toBe(n.updated_at);
  });

  it('soft-deletes: row stays, hidden from reads, and takes its blocks and edges with it', async () => {
    await page('p1');
    await page('p2');
    await repo.createBlock({ id: 'b1', pageId: 'p1', type: 'text', plainText: 'hi' });
    await repo.link('p1', 'p2', 'LINKS_TO');
    await repo.deleteNode('p1');

    expect(await repo.getNode('p1')).toBeNull();
    const row = await repo.getNode('p1', true);
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.device_id).toBe('dev-A');
    expect(await repo.getBlock('b1')).toBeNull();
    expect(await repo.listEdges({ type: 'LINKS_TO' })).toEqual([]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM nodes').get()).toEqual({ n: 2 });
  });

  it('keeps tag names unique ignoring case, but allows repeated group names', async () => {
    await repo.createNode({ type: 'tag', title: 'Work' });
    await expect(repo.createNode({ type: 'tag', title: 'work' })).rejects.toThrow();
    await repo.createNode({ type: 'group', title: 'Misc' });
    await repo.createNode({ type: 'group', title: 'Misc' });
  });

  it('rejects unknown fields', async () => {
    await expect(repo.createNode({ type: 'page', ['title; DROP TABLE nodes']: 'x' } as never)).rejects.toThrow(/unknown field/);
  });
});

describe('edges', () => {
  beforeEach(async () => {
    await page('a');
    await page('b');
  });

  it('gives the same relationship the same id and row, however often it is created', async () => {
    const e1 = await repo.link('a', 'b', 'LINKS_TO');
    const e2 = await repo.link('a', 'b', 'LINKS_TO');
    expect(e1.id).toBe(await edgeId('a', 'b', 'LINKS_TO'));
    expect(e2.id).toBe(e1.id);
    expect(e2.updated_at).toBe(e1.updated_at);
    expect(await repo.listEdges()).toHaveLength(1);
  });

  it('updates props when linking again with different props', async () => {
    await repo.link('a', 'b', 'LINKS_TO', { block_id: 'b1' });
    const e = await repo.link('a', 'b', 'LINKS_TO', { block_id: 'b2' });
    expect(JSON.parse(e.props)).toEqual({ block_id: 'b2' });
    expect(await repo.listEdges()).toHaveLength(1);
  });

  it('treats direction and type as part of identity', async () => {
    await repo.link('a', 'b', 'LINKS_TO');
    await repo.link('b', 'a', 'LINKS_TO');
    await repo.link('a', 'b', 'RELATED');
    expect(await repo.listEdges()).toHaveLength(3);
    expect(await repo.listEdges({ src: 'a' })).toHaveLength(2);
    expect(await repo.listEdges({ dst: 'a', type: 'LINKS_TO' })).toHaveLength(1);
  });

  it('soft-deletes on unlink, and revives the same row when recreated', async () => {
    const first = await repo.link('a', 'b', 'LINKS_TO');
    expect(await repo.unlink('a', 'b', 'LINKS_TO')).toBe(true);
    expect(await repo.unlink('a', 'b', 'LINKS_TO')).toBe(false);
    expect(await repo.listEdges()).toEqual([]);
    expect((await repo.getEdge('a', 'b', 'LINKS_TO', true))?.deleted_at).not.toBeNull();

    const revived = await repo.link('a', 'b', 'LINKS_TO');
    expect(revived.id).toBe(first.id);
    expect(revived.deleted_at).toBeNull();
    expect(revived.created_at).toBe(first.created_at);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM edges').get()).toEqual({ n: 1 });
  });

  it('refuses self-links and unknown nodes', async () => {
    await expect(repo.link('a', 'a', 'RELATED')).rejects.toThrow();
    await expect(repo.link('a', 'nope', 'RELATED')).rejects.toThrow();
  });

  it('feeds the backlinks view only while both pages are live', async () => {
    await repo.link('a', 'b', 'LINKS_TO');
    const back = () => sqlite.prepare("SELECT source_page_id FROM v_backlinks WHERE page_id = 'b'").all();
    expect(back()).toEqual([{ source_page_id: 'a' }]);
    await repo.deleteNode('a');
    expect(back()).toEqual([]);
  });
});

describe('blocks and connectors', () => {
  beforeEach(async () => {
    await page('p');
  });

  it('creates, updates and soft-deletes blocks', async () => {
    const b = await repo.createBlock({ id: 'b1', pageId: 'p', type: 'text', x: 5, content: { html: '<p>x</p>' } });
    expect(b).toMatchObject({ x: 5, w: 200, content: '{"html":"<p>x</p>"}', device_id: 'dev-A' });
    expect((await repo.updateBlock('b1', { x: 50 })).x).toBe(50);
    await repo.deleteBlock('b1');
    expect(await repo.listBlocks('p')).toEqual([]);
    expect(await repo.listBlocks('p', true)).toHaveLength(1);
    await expect(repo.updateBlock('b1', { x: 1 })).rejects.toThrow(/not found/);
  });

  it('accepts every block type the app has', async () => {
    for (const type of ['text', 'image', 'checklist', 'code', 'table', 'frame']) {
      await repo.createBlock({ pageId: 'p', type });
    }
    await expect(repo.createBlock({ pageId: 'p', type: 'bogus' })).rejects.toThrow();
  });

  it('creates, updates and soft-deletes connectors', async () => {
    await repo.createBlock({ id: 'b1', pageId: 'p', type: 'text' });
    await repo.createBlock({ id: 'b2', pageId: 'p', type: 'text' });
    const c = await repo.createConnector({ id: 'c1', pageId: 'p', fromBlockId: 'b1', toBlockId: 'b2', style: { heads: 'one' } });
    expect(c.style).toBe('{"heads":"one"}');
    expect((await repo.updateConnector('c1', { label: 'causes' })).label).toBe('causes');
    await repo.deleteConnector('c1');
    expect(await repo.listConnectors('p')).toEqual([]);
    await expect(repo.createConnector({ pageId: 'p', fromBlockId: 'b1', toBlockId: 'b1' })).rejects.toThrow();
  });
});

describe('assets', () => {
  it('creates, soft-deletes, and frees the hash for reuse', async () => {
    const a = await repo.createAsset({ id: 'a1', sha256: 'abc', relPath: 'images/a1.png', mime: 'image/png', sizeBytes: 10, width: 4, height: 3 });
    expect(a).toMatchObject({ rel_path: 'images/a1.png', size_bytes: 10, device_id: 'dev-A' });
    await expect(repo.createAsset({ sha256: 'abc', relPath: 'x', mime: 'image/png', sizeBytes: 1 })).rejects.toThrow();
    await repo.deleteAsset('a1');
    expect(await repo.getAsset('a1')).toBeNull();
    await repo.createAsset({ sha256: 'abc', relPath: 'x', mime: 'image/png', sizeBytes: 1 });
  });
});

describe('devices', () => {
  it('stores the device once', async () => {
    await repo.ensureDevice('dev-A', 'Renamed');
    expect(sqlite.prepare('SELECT id, name FROM devices').all()).toEqual([{ id: 'dev-A', name: 'Test' }]);
  });
});

describe('full-text search triggers', () => {
  beforeEach(async () => {
    await page('p');
  });
  const hits = async (q: string) => (await repo.searchBlocks(q)).map((h) => h.blockId);

  it('indexes new blocks and finds prefixes', async () => {
    await repo.createBlock({ id: 'b1', pageId: 'p', type: 'text', plainText: 'Quarterly budget review' });
    expect(await hits('budget')).toEqual(['b1']);
    expect(await hits('budg')).toEqual(['b1']);
    expect((await repo.searchBlocks('budget'))[0]).toMatchObject({ pageId: 'p', snippet: 'Quarterly [budget] review' });
  });

  it('does not index empty text', async () => {
    await repo.createBlock({ id: 'b1', pageId: 'p', type: 'frame' });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM search_blocks').get()).toEqual({ n: 0 });
  });

  it('follows edits to the text', async () => {
    await repo.createBlock({ id: 'b1', pageId: 'p', type: 'text', plainText: 'apples' });
    await repo.updateBlock('b1', { plainText: 'oranges' });
    expect(await hits('apples')).toEqual([]);
    expect(await hits('oranges')).toEqual(['b1']);
  });

  it('drops a soft-deleted block from search', async () => {
    await repo.createBlock({ id: 'b1', pageId: 'p', type: 'text', plainText: 'secret plans' });
    await repo.deleteBlock('b1');
    expect(await hits('secret')).toEqual([]);
  });

  it('drops the blocks of a deleted page, and brings them back if the block is revived', async () => {
    await repo.createBlock({ id: 'b1', pageId: 'p', type: 'text', plainText: 'secret plans' });
    await repo.deleteNode('p');
    expect(await hits('secret')).toEqual([]);
    await repo.putNode({ id: 'p', type: 'page', title: 'p' });
    await repo.putBlock({ id: 'b1', pageId: 'p', type: 'text', plainText: 'secret plans' });
    expect(await hits('secret')).toEqual(['b1']);
  });

  it('indexes node titles and removes deleted ones', async () => {
    const find = () => sqlite.prepare("SELECT node_id FROM search_nodes WHERE search_nodes MATCH 'zebra'").all();
    await repo.createNode({ id: 't1', type: 'tag', title: 'zebra' });
    expect(find()).toEqual([{ node_id: 't1' }]);
    await repo.deleteNode('t1');
    expect(find()).toEqual([]);
  });

  it('survives punctuation in the query', async () => {
    await repo.createBlock({ id: 'b1', pageId: 'p', type: 'text', plainText: 'hello world' });
    expect(await hits('"hello" (wor')).toEqual(['b1']); // quotes and brackets are not FTS syntax errors
    expect(await repo.searchBlocks('   ')).toEqual([]);
  });
});

describe('transactions', () => {
  it('rolls back everything if a step fails', async () => {
    await page('a');
    await expect(
      repo.transaction(async () => {
        await repo.createNode({ id: 'x', type: 'page', title: 'x' });
        await repo.link('a', 'a', 'RELATED'); // violates src <> dst
      }),
    ).rejects.toThrow();
    expect(await repo.getNode('x', true)).toBeNull();
  });
});
