import { beforeEach, describe, expect, it } from 'vitest';
import { memoryGraph } from './graphdb';
import { GraphMirror, type LegacyPage } from '../src/graph/mirror';
import { htmlToText } from '../src/graph/text';
import type { Block } from '../src/types';

let mirror: GraphMirror;
let sqlite: Awaited<ReturnType<typeof memoryGraph>>['sqlite'];
beforeEach(async () => {
  const g = await memoryGraph();
  sqlite = g.sqlite;
  mirror = new GraphMirror(g.repo);
});
const repo = () => mirror.repo;

const text = (id: string, html: string, extra: Partial<Block> = {}) => ({ id, type: 'text', x: 8, y: 16, w: 280, h: 40, z: 1, html, ...extra }) as Block;
const page = (id: string, extra: Partial<LegacyPage> = {}): LegacyPage => ({ id, title: id, groupId: null, tags: [], blocks: [], arrows: [], created: 5, ...extra });

describe('htmlToText', () => {
  it('strips tags and entities and keeps line breaks', () => {
    expect(htmlToText('<p>Tom &amp; Jerry</p><p>second&nbsp;line<br>third</p>')).toBe('Tom & Jerry\nsecond line\nthird');
    expect(htmlToText('')).toBe('');
  });
});

describe('page projection', () => {
  it('turns a page into a node, blocks and connectors', async () => {
    const blocks = [
      text('b1', '<p>Hello <b>world</b></p>'),
      { id: 'b2', type: 'checklist', x: 0, y: 0, w: 288, h: 48, z: 2, items: [{ id: 'i', text: 'buy milk', done: false }] } as Block,
      { id: 'b3', type: 'frame', x: 0, y: 0, w: 360, h: 240, z: 0, title: 'Ideas', color: 'teal', collapsed: false } as Block,
    ];
    await mirror.page(page('p', { title: 'My page', blocks, arrows: [{ id: 'a1', from: 'b1', to: 'b2', heads: 'one', style: 'dashed', z: 3, label: 'then' }] }));

    expect(await repo().getNode('p')).toMatchObject({ type: 'page', title: 'My page', created_at: 5 });
    const rows = await repo().listBlocks('p');
    expect(rows.map((r) => [r.id, r.type, r.plain_text])).toEqual([
      ['b3', 'frame', 'Ideas'],
      ['b1', 'text', 'Hello world'],
      ['b2', 'checklist', 'buy milk'],
    ]);
    // Geometry is in columns; everything else the block needs is kept in content.
    expect(JSON.parse(rows[1].content)).toEqual({ html: '<p>Hello <b>world</b></p>' });
    expect(rows[1]).toMatchObject({ x: 8, y: 16, w: 280, h: 40, z: 1 });
    const [c] = await repo().listConnectors('p');
    expect(c).toMatchObject({ id: 'a1', from_block_id: 'b1', to_block_id: 'b2', label: 'then' });
    expect(JSON.parse(c.style)).toEqual({ heads: 'one', style: 'dashed', z: 3 });
    expect((await repo().searchBlocks('milk'))[0].pageId).toBe('p');
  });

  it('follows edits: removed blocks and arrows are soft-deleted and leave the search index', async () => {
    const b1 = text('b1', 'keep me');
    const b2 = text('b2', 'drop me');
    const arrow = { id: 'a1', from: 'b1', to: 'b2', heads: 'none' as const, style: 'solid' as const, z: 0 };
    await mirror.page(page('p', { blocks: [b1, b2], arrows: [arrow] }));
    await mirror.page(page('p', { blocks: [text('b1', 'kept, edited')], arrows: [arrow] }));

    expect((await repo().listBlocks('p')).map((b) => b.id)).toEqual(['b1']);
    expect(await repo().listBlocks('p', true)).toHaveLength(2);
    expect(await repo().listConnectors('p')).toEqual([]); // its end is gone
    expect(await repo().searchBlocks('drop')).toEqual([]);
    expect((await repo().searchBlocks('edited')).map((h) => h.blockId)).toEqual(['b1']);
  });

  it('leaves unchanged rows alone', async () => {
    const p = page("p", { blocks: [text("b1", "same")], tags: ["t"], etag: "e1" });
    await mirror.page(p);
    const snap = () =>
      JSON.stringify(
        ['nodes', 'edges', 'blocks'].map((t) => sqlite.prepare(`SELECT id, updated_at FROM ${t} ORDER BY id`).all()),
      );
    const before = snap();
    await mirror.page(p);
    expect(snap()).toBe(before);
  });

  it('removes a deleted page along with its blocks', async () => {
    await mirror.page(page('p', { blocks: [text('b1', 'gone soon')] }));
    await mirror.page({ ...page('p'), deleted: true });
    expect(await repo().getNode('p')).toBeNull();
    expect(await repo().searchBlocks('gone')).toEqual([]);
    await mirror.page(page('p', { blocks: [text('b1', 'gone soon')] })); // edited again: comes back
    expect(await repo().getNode('p')).not.toBeNull();
    expect(await repo().searchBlocks('gone')).toHaveLength(1);
  });

  it('keeps pages that share block ids (a sync conflict copy) apart', async () => {
    await mirror.page(page('p1', { blocks: [text('b1', 'original')] }));
    await mirror.page(page('p2', { blocks: [text('b1', 'copy')] }));
    await mirror.page(page('p2', { blocks: [text('b1', 'copy edited')] }));
    expect((await repo().listBlocks('p1')).map((b) => b.plain_text)).toEqual(['original']);
    expect((await repo().listBlocks('p2')).map((b) => b.plain_text)).toEqual(['copy edited']);
  });

  it('drops arrows that point at missing blocks', async () => {
    await mirror.page(page('p', { blocks: [text('b1', 'x')], arrows: [{ id: 'a', from: 'b1', to: 'ghost', heads: 'one', style: 'solid', z: 0 }] }));
    expect(await repo().listConnectors('p')).toEqual([]);
  });
});

describe('tags', () => {
  it('makes one tag node per name, ignoring case, and joins pages to it', async () => {
    await mirror.page(page('p1', { tags: ['Work', 'ideas'] }));
    await mirror.page(page('p2', { tags: ['work'] }));
    const tags = await repo().listNodes('tag');
    expect(tags.map((t) => t.title).sort()).toEqual(['Work', 'ideas']);
    const counts = sqlite.prepare('SELECT tag, page_count FROM v_tag_counts ORDER BY tag').all();
    expect(counts).toEqual([{ tag: 'Work', page_count: 2 }, { tag: 'ideas', page_count: 1 }]);
  });

  it('drops the edge when a tag is removed and revives it when added back', async () => {
    await mirror.page(page('p', { tags: ['a', 'b'] }));
    await mirror.page(page('p', { tags: ['a'] }));
    expect(sqlite.prepare("SELECT tag FROM v_page_tags WHERE page_id = 'p'").all()).toEqual([{ tag: 'a' }]);
    await mirror.page(page('p', { tags: ['a', 'b'] }));
    expect(await repo().listEdges({ src: 'p', type: 'TAGGED' })).toHaveLength(2);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM edges').get()).toEqual({ n: 2 });
  });

  it('gives the same tag the same node id on every device', async () => {
    const other = new GraphMirror((await memoryGraph('dev-B')).repo);
    await mirror.page(page('p', { tags: ['Shared'] }));
    await other.page(page('q', { tags: ['shared'] }));
    expect((await repo().listNodes('tag'))[0].id).toBe((await other.repo.listNodes('tag'))[0].id);
  });
});

describe('groups', () => {
  const groups = [
    { id: 'g1', name: 'Work', color: 'teal', parentId: null },
    { id: 'g2', name: 'Work', color: 'plum', parentId: 'g1' }, // same name, nested: allowed
  ];

  it('creates group nodes with PARENT_OF edges and IN_GROUP membership', async () => {
    await mirror.groups(groups);
    await mirror.page(page('p', { groupId: 'g2' }));
    expect(await repo().listEdges({ type: 'PARENT_OF' })).toMatchObject([{ src: 'g1', dst: 'g2' }]);
    expect(await repo().listEdges({ type: 'IN_GROUP' })).toMatchObject([{ src: 'p', dst: 'g2' }]);
  });

  it('moves a page and re-parents a group', async () => {
    await mirror.groups(groups);
    await mirror.page(page('p', { groupId: 'g1' }));
    await mirror.page(page('p', { groupId: 'g2' }));
    expect(await repo().listEdges({ type: 'IN_GROUP' })).toMatchObject([{ dst: 'g2' }]);
    await mirror.groups([groups[0], { ...groups[1], parentId: null }]);
    expect(await repo().listEdges({ type: 'PARENT_OF' })).toEqual([]);
  });

  it('deleting a group removes it and its membership edges', async () => {
    await mirror.groups(groups);
    await mirror.page(page('p', { groupId: 'g2' }));
    await mirror.groups([groups[0]]);
    expect(await repo().getNode('g2')).toBeNull();
    expect(await repo().listEdges({ type: 'IN_GROUP' })).toEqual([]);
  });

  it('skips membership of a group that has not arrived yet, and fills it in when it does', async () => {
    await mirror.page(page('p', { groupId: 'g1' }));
    expect(await repo().listEdges({ type: 'IN_GROUP' })).toEqual([]);
    await mirror.group(groups[0]);
    await mirror.page(page('p', { groupId: 'g1' }));
    expect(await repo().listEdges({ type: 'IN_GROUP' })).toHaveLength(1);
  });
});

describe('queueing', () => {
  it('runs projections in call order even when not awaited', async () => {
    void mirror.page(page('p', { title: 'first' }));
    void mirror.page(page('p', { title: 'second' }));
    await mirror.idle();
    expect((await repo().getNode('p'))!.title).toBe('second');
  });
});

describe('[[links]]', () => {
  const linking = (id: string, html: string, extra: Partial<LegacyPage> = {}) => page(id, { blocks: [text(`${id}-b`, html)], ...extra });
  const backs = async (id: string) => (await mirror.backlinks(id)).map((b) => b.pageId);

  it('creates a LINKS_TO edge, ignoring case, with the block of the first mention', async () => {
    await mirror.page(page('target', { title: 'Project Plan' }));
    await mirror.page(linking('a', '<p>see [[project plan]] and [[Project Plan]]</p>'));
    expect(await mirror.backlinks('target')).toEqual([{ pageId: 'a', title: 'a', blockId: 'a-b' }]);
  });

  it('ignores links to missing pages and to itself, and fills them in when the target arrives', async () => {
    await mirror.page(linking('a', '[[Later]] [[a]]'));
    expect(await repo().listEdges({ type: 'LINKS_TO' })).toEqual([]);
    await mirror.page(page('later', { title: 'Later' }));
    expect(await backs('later')).toEqual(['a']);
  });

  it('drops the edge when the link is removed, or the target renamed or deleted', async () => {
    await mirror.page(page('t', { title: 'Target' }));
    await mirror.page(linking('a', '[[Target]]'));
    await mirror.page(linking('a', 'no link now'));
    expect(await backs('t')).toEqual([]);
    await mirror.page(linking('a', '[[Target]]'));
    expect(await backs('t')).toEqual(['a']);
    await mirror.page(page('t', { title: 'Renamed' }));
    expect(await backs('t')).toEqual([]);
    await mirror.page(page('t', { title: 'Target' }));
    expect(await backs('t')).toEqual(['a']);
    await mirror.removePage('t');
    expect(await backs('t')).toEqual([]);
  });

  it('is found by search, with the page title', async () => {
    await mirror.page(page('s', { title: 'Shopping', blocks: [text('sb', '<p>buy oat milk</p>')] }));
    expect(await mirror.search('oat')).toMatchObject([{ pageId: 's', blockId: 'sb', title: 'Shopping' }]);
    await mirror.removePage('s');
    expect(await mirror.search('oat')).toEqual([]);
  });
});
