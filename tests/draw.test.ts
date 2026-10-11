import { describe, expect, it } from 'vitest';
import { memoryGraph } from './graphdb';
import { GraphMirror, type LegacyPage } from '../src/graph/mirror';
import { pageToMarkdown } from '../src/export/export';
import { blockHeight, BLOCK_LABEL } from '../src/lib/util';
import { BLOCK_DEFAULTS } from '../src/store/notes';
import type { Block, DrawBlock, Page } from '../src/types';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
const draw = (extra: Partial<DrawBlock> = {}): DrawBlock => ({
  id: 'd1', type: 'draw', x: 10, y: 20, w: 420, h: 300, z: 1, scene: '{"elements":[{"id":"e"}]}', preview: SVG, ...extra,
});
const page = (blocks: Block[]): Page => ({ id: 'p', title: 'Sketch', groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 1 });

describe('drawing box', () => {
  it('starts empty at a usable size', () => {
    expect(BLOCK_DEFAULTS.draw()).toEqual({ w: 420, h: 300, scene: '', preview: '' });
    expect(BLOCK_LABEL.draw).toBe('Drawing');
  });

  it('has a fixed height like a picture, not a minimum height', () => {
    expect(blockHeight(draw({ h: 300, ah: 500 }))).toBe(300);
  });

  it('is mirrored into the graph without its SVG preview', async () => {
    const { repo } = await memoryGraph();
    const mirror = new GraphMirror(repo);
    const legacy: LegacyPage = { id: 'p', title: 'Sketch', groupId: null, tags: [], blocks: [draw()], arrows: [], created: 1 };
    await mirror.page(legacy);
    const rows = await repo.listBlocks('p');
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('shape');
    const content = JSON.parse(rows[0].content);
    expect(content.scene).toContain('elements');
    expect(content.preview).toBeUndefined();
  });

  it('exports as an image link in Markdown, and is left out when empty', () => {
    const md = pageToMarkdown(page([draw()]), () => '', (b) => (b.preview ? `images/drawing-${b.id}.svg` : ''));
    expect(md).toContain('![Drawing](images/drawing-d1.svg)');
    const empty = pageToMarkdown(page([draw({ scene: '', preview: '' })]), () => '', (b) => (b.preview ? 'x.svg' : ''));
    expect(empty).not.toContain('Drawing');
  });
});
