import { describe, expect, it } from 'vitest';
import { cleanBlock } from '../src/lib/sanitize';
import { cleanHeader, hasHeader, isFolded, noteText, setNoteStyle } from '../src/lib/note';
import { blockPlainText } from '../src/lib/pageText';
import { NOTE_HEAD_H, blockHeight, blockText } from '../src/lib/util';
import { pageToMarkdown } from '../src/export/export';
import type { Block, NoteBlock, Page } from '../src/types';

const geo = { x: 0, y: 0, w: 200, h: 120, z: 1 };
const note = (o: Partial<NoteBlock> = {}): NoteBlock => ({ id: 'n', type: 'note', style: 'text', ...geo, html: '<p>Body</p>', ...o });

describe('the optional header of a text box', () => {
  it('only a plain text box has one', () => {
    expect(hasHeader(note({ header: 'Plan' }))).toBe(true);
    expect(hasHeader(note({ header: '' }))).toBe(true); // a header with no title yet
    expect(hasHeader(note())).toBe(false);
    expect(hasHeader(note({ style: 'sticky', header: 'x' }))).toBe(false);
    expect(hasHeader(note({ style: 'code', header: 'x' }))).toBe(false);
    expect(hasHeader(note({ header: 'x', doc: { kind: 'doc' } as never }))).toBe(false);
  });
  it('is kept and repaired when read', () => {
    expect(cleanBlock(note({ header: '  Plan  ' }))).toMatchObject({ header: 'Plan' });
    expect(cleanBlock(note({ header: 'a\n  b\tc' }))).toMatchObject({ header: 'a b c' });
    expect((cleanBlock(note({ header: 'x'.repeat(500) })) as NoteBlock).header).toHaveLength(200);
    expect(cleanBlock(note({ header: '', folded: true }))).toMatchObject({ header: '', folded: true });
  });
  it('is dropped where it makes no sense, and a fold without a header is dropped', () => {
    for (const bad of [note({ style: 'sticky', header: 'x', folded: true }), note({ style: 'code', header: 'x' }), note({ folded: true })]) {
      const out = cleanBlock(bad) as NoteBlock;
      expect(out).not.toHaveProperty('header');
      expect(out).not.toHaveProperty('folded');
    }
    expect(cleanBlock(note({ header: 42 as never }))).not.toHaveProperty('header');
    expect(cleanBlock(note({ header: 'x', folded: 'yes' as never }))).not.toHaveProperty('folded');
  });
  it('cleans a stored header to one short line', () => {
    expect(cleanHeader(' a   b ')).toBe('a b');
    expect(cleanHeader(null)).toBeNull();
  });
});

describe('folding', () => {
  it('a folded box is just its header high, an open one is as tall as it was', () => {
    expect(isFolded(note({ header: 'x', folded: true }))).toBe(true);
    expect(isFolded(note({ folded: true }))).toBe(false); // no header: nothing to fold to
    expect(blockHeight(note({ header: 'x', folded: true }) as Block)).toBe(NOTE_HEAD_H);
    expect(blockHeight(note({ header: 'x' }) as Block)).toBe(120);
  });
});

describe('the words of a box include its header', () => {
  it('for search, the page text and plain text', () => {
    const b = note({ header: 'Shopping', html: '<p>Milk</p>' });
    expect(blockPlainText(b as Block)).toBe('Shopping\nMilk');
    expect(blockText(b as Block)).toContain('Shopping');
    expect(noteText(b)).toBe('Shopping\nMilk');
    expect(noteText(note({ html: '<p>Milk</p>' }))).toBe('Milk');
  });
});

describe('changing the style of a box with a header', () => {
  it('keeps the header words: bold first line in a sticky, first line of code', () => {
    const s = note({ header: 'Plan', folded: true });
    setNoteStyle(s, 'sticky');
    expect(s).not.toHaveProperty('header');
    expect(s).not.toHaveProperty('folded');
    expect(s.html).toBe('<p><strong>Plan</strong></p><p>Body</p>');
    const c = note({ header: 'Plan' });
    setNoteStyle(c, 'code');
    expect(c.code).toBe('Plan\nBody');
    expect(c).not.toHaveProperty('header');
  });
  it('escapes the header, and an empty header adds nothing', () => {
    const s = note({ header: '<b>&' });
    setNoteStyle(s, 'sticky');
    expect(s.html).toContain('&lt;b&gt;&amp;');
    const e = note({ header: '' });
    setNoteStyle(e, 'sticky');
    expect(e.html).toBe('<p>Body</p>');
  });
});

describe('Markdown export', () => {
  const page = (b: NoteBlock): Page => ({ id: 'p', title: 'T', groupId: null, tags: [], blocks: [b as Block], arrows: [], created: 1, updated: 1, rev: 0 });
  it('writes the header as a bold line above the text', () => {
    const md = pageToMarkdown(page(note({ header: 'Shopping', html: '<p>Milk</p>' })), () => '');
    expect(md).toContain('**Shopping**\n\nMilk');
  });
  it('leaves a box without a header as it was', () => {
    const md = pageToMarkdown(page(note({ html: '<p>Milk</p>' })), () => '');
    expect(md).not.toContain('**');
  });
});
