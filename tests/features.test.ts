import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { guideLines, nearestShift } from '../src/lib/guides';

vi.mock('../src/components/library/Thumbnail', () => ({ StaticBody: () => null }));
vi.mock('../src/store/notes', () => ({ getStorage: () => null, useNotes: { getState: () => ({ pages: {} }) } }));
vi.mock('../src/store/ui', () => ({ toast: () => {} }));
import { jpegToPdf, pageToMarkdown, readingOrder } from '../src/export/export';
import type { Page } from '../src/types';

describe('snap guides', () => {
  const other = { x: 100, y: 100, w: 200, h: 100 };

  it('snaps a left edge to a nearby left edge and draws a line', () => {
    const moving = { x: 104, y: 300, w: 120, h: 60 };
    expect(nearestShift(moving, [other], 6, 'x')).toBe(-4);
    const lines = guideLines({ ...moving, x: 100 }, [other]);
    expect(lines).toContainEqual({ axis: 'x', pos: 100, from: 100, to: 360 });
  });

  it('lines up centres', () => {
    const moving = { x: 0, y: 300, w: 100, h: 50 }; // centre 50 vs other centre 200
    expect(nearestShift({ ...moving, x: 147 }, [other], 6, 'x')).toBe(3);
  });

  it('ignores boxes that are too far away', () => {
    expect(nearestShift({ x: 400, y: 400, w: 50, h: 50 }, [other], 6, 'x')).toBeNull();
  });

  it('picks the closest of several matches', () => {
    const a = { x: 93, y: 0, w: 2, h: 10 }; // nearest edge 95: 5 away
    const b = { x: 101, y: 0, w: 10, h: 10 };
    expect(nearestShift({ x: 100, y: 50, w: 30, h: 10 }, [a, b], 6, 'x', ['start'])).toBe(1);
  });

  it('only uses the requested edges (resizing snaps the right/bottom edge)', () => {
    const r = { x: 0, y: 0, w: 297, h: 40 }; // right edge 297 vs other right edge 300
    expect(nearestShift(r, [other], 6, 'x', ['end'])).toBe(3);
    expect(nearestShift({ x: 98, y: 0, w: 50, h: 40 }, [other], 6, 'x', ['end'])).toBeNull();
  });
});

const page: Page = {
  id: 'p', title: 'Groundwater model', groupId: null, tags: ['research', 'ml'], created: 1, updated: 1, rev: 1,
  arrows: [],
  blocks: [
    { id: 'c', type: 'code', x: 400, y: 300, w: 300, h: 50, z: 1, code: 'print("hi")' },
    { id: 't', type: 'text', x: 0, y: 0, w: 300, h: 40, z: 1, html: '<h2>Goals</h2><p>Predict <strong>levels</strong> with <s>LSTM</s> GBMs.</p><ul><li><p>One</p></li></ul>' },
    { id: 'l', type: 'checklist', x: 0, y: 300, w: 300, h: 50, z: 1, items: [{ id: '1', text: 'Clean data', done: true }, { id: '2', text: 'Train', done: false }] },
    { id: 'tb', type: 'table', x: 0, y: 600, w: 300, h: 50, z: 1, rows: [['Model', 'RMSE'], ['GBM', '0.41'], ['a|b', '']] },
    { id: 'i', type: 'image', x: 400, y: 10, w: 100, h: 100, z: 1, imageId: 'img1', aspect: 1, alt: 'Well map' },
  ],
};

describe('Markdown export', () => {
  it('reads boxes top-to-bottom, side-by-side boxes left-to-right', () => {
    expect(readingOrder(page.blocks).map((b) => b.id)).toEqual(['t', 'i', 'l', 'c', 'tb']);
  });

  it('turns every kind of box into Markdown', () => {
    const md = pageToMarkdown(page, (b) => `images/${b.imageId}.png`);
    expect(md).toBe(
      [
        '# Groundwater model',
        '#research #ml',
        '## Goals\n\nPredict **levels** with ~~LSTM~~ GBMs.\n\n-   One',
        '![Well map](images/img1.png)',
        '- [x] Clean data\n- [ ] Train',
        '```\nprint("hi")\n```',
        '| Model | RMSE |\n| --- | --- |\n| GBM | 0.41 |\n| a\\|b |   |',
      ].join('\n\n') + '\n',
    );
  });

  it('lists connectors as a Connections section, falling back to block type when a block has no text', () => {
    const withArrows: Page = {
      ...page,
      arrows: [
        { id: 'a1', from: 't', to: 'c', heads: 'one', style: 'solid', z: 1 },
        { id: 'a2', from: 'i', to: 'tb', heads: 'both', style: 'dashed', label: 'depends on', z: 2 },
      ],
    };
    const md = pageToMarkdown(withArrows, (b) => `images/${b.imageId}.png`);
    expect(md).toContain('## Connections\n\n- Goals → print("hi")\n- Image ↔ Model RMSE GBM 0.41 a|b (depends on)');
  });
});

describe('PDF export', () => {
  it('writes a valid one-page PDF that a real PDF tool can read and render', () => {
    // A tiny real JPEG, made with ImageMagick.
    const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
    execFileSync('convert', ['-size', '64x40', 'xc:#2b47c9', join(dir, 'a.jpg')]);
    const jpeg = new Uint8Array(execFileSync('cat', [join(dir, 'a.jpg')]));
    const pdf = jpegToPdf(jpeg, 64, 40, 640, 400);
    writeFileSync(join(dir, 'a.pdf'), pdf);
    const info = execFileSync('pdfinfo', [join(dir, 'a.pdf')]).toString();
    expect(info).toMatch(/Pages:\s+1/);
    expect(info).toMatch(/Page size:\s+480 x 300 pts/);
    execFileSync('pdftoppm', ['-png', '-r', '20', join(dir, 'a.pdf'), join(dir, 'out')]);
  });

  it('shrinks very large pages to stay within PDF size limits', () => {
    const pdf = jpegToPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 10, 10, 40000, 1000);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text).toContain('/MediaBox [0 0 14400 360]');
  });
});
