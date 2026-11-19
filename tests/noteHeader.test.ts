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
  it('a text box or a sticky can have one, code and a document cannot', () => {
    expect(hasHeader(note({ header: 'Plan' }))).toBe(true);
    expect(hasHeader(note({ header: '' }))).toBe(true); // a header with no title yet
    expect(hasHeader(note())).toBe(false);
    expect(hasHeader(note({ style: 'sticky', header: 'x' }))).toBe(true);
    expect(hasHeader(note({ style: 'sticky', header: 'x', doc: { kind: 'doc' } as never }))).toBe(false);
    expect(hasHeader(note({ style: 'code', header: 'x' }))).toBe(false);
    expect(hasHeader(note({ header: 'x', doc: { kind: 'doc' } as never }))).toBe(false);
  });
  it('is kept and repaired when read', () => {
    expect(cleanBlock(note({ header: '  Plan  ' }))).toMatchObject({ header: 'Plan' });
    expect(cleanBlock(note({ header: 'a\n  b\tc' }))).toMatchObject({ header: 'a b c' });
    expect((cleanBlock(note({ header: 'x'.repeat(500) })) as NoteBlock).header).toHaveLength(200);
    expect(cleanBlock(note({ header: '', folded: true }))).toMatchObject({ header: '', folded: true });
  });
  it('is kept on a sticky too', () => {
    expect(cleanBlock(note({ style: 'sticky', header: ' Idea ', folded: true }))).toMatchObject({ header: 'Idea', folded: true });
  });
  it('is dropped where it makes no sense, and a fold without a header is dropped', () => {
    for (const bad of [note({ style: 'sticky', folded: true }), note({ style: 'code', header: 'x' }), note({ folded: true })]) {
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
    expect(blockHeight(note({ style: 'sticky', header: 'x', folded: true }) as Block)).toBe(NOTE_HEAD_H); // a sticky folds to its header too
    expect(blockHeight(note({ style: 'sticky', header: 'x' }) as Block)).toBe(120);
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
  it('keeps the header between text and sticky (and its fold)', () => {
    const s = note({ header: 'Plan', folded: true });
    setNoteStyle(s, 'sticky');
    expect(s).toMatchObject({ style: 'sticky', header: 'Plan', folded: true, html: '<p>Body</p>' });
    setNoteStyle(s, 'text');
    expect(s).toMatchObject({ style: 'text', header: 'Plan', folded: true });
  });
  it('keeps the words when going to code, which has no header: the title becomes the first line', () => {
    const c = note({ header: 'Plan', folded: true });
    setNoteStyle(c, 'code');
    expect(c.code).toBe('Plan\nBody');
    expect(c).not.toHaveProperty('header');
    expect(c).not.toHaveProperty('folded');
  });
  it('escapes the header, and an empty header adds nothing', () => {
    const s = note({ header: '<b>&' });
    setNoteStyle(s, 'code');
    expect(s.code).toContain('<b>&'); // plain text in code, not markup
    const e = note({ header: '' });
    setNoteStyle(e, 'code');
    expect(e.code).toBe('Body');
    expect(e).not.toHaveProperty('header');
  });
});

describe('Markdown export', () => {
  const page = (b: NoteBlock): Page => ({ id: 'p', title: 'T', groupId: null, tags: [], blocks: [b as Block], arrows: [], created: 1, updated: 1, rev: 0 });
  it('writes the header as a bold line above the text', () => {
    const md = pageToMarkdown(page(note({ header: 'Shopping', html: '<p>Milk</p>' })), () => '');
    expect(md).toContain('**Shopping**\n\nMilk');
  });
  it('writes a sticky\'s header as the bold first line of its quote, and keeps a header-only sticky', () => {
    const md = pageToMarkdown(page(note({ style: 'sticky', tint: 'blue', header: 'Idea', html: '<p>Try it</p>' })), () => '');
    expect(md).toContain('> 📝 **Idea**\n> Try it');
    const only = pageToMarkdown(page(note({ style: 'sticky', header: 'Just a title', html: '' })), () => '');
    expect(only).toContain('> 📝 **Just a title**');
  });
  it('leaves a box without a header as it was', () => {
    const md = pageToMarkdown(page(note({ html: '<p>Milk</p>' })), () => '');
    expect(md).not.toContain('**');
  });
});
