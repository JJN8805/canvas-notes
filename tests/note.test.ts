import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { cleanBlock } from '../src/lib/sanitize';
import { kindClass, legacyNote, losesFormatting, noteText, setNoteStyle } from '../src/lib/note';
import { blockPlainText } from '../src/lib/pageText';
import { normalizePage } from '../src/storage/types';
import { addBlock, setNoteStyleOf, undo, useNotes } from '../src/store/notes';
import type { Block, NoteBlock, Page } from '../src/types';

const geo = { x: 0, y: 0, w: 100, h: 40, z: 1 };
const note = (o: Partial<NoteBlock> = {}): NoteBlock => ({ id: 'n', type: 'note', style: 'text', ...geo, html: '<p>Hello</p>', ...o });

describe('boxes written before notes existed', () => {
  it('a text, sticky or code box is read as a note of that style, with everything else kept', () => {
    expect(cleanBlock({ id: 't', type: 'text', ...geo, html: '<p>a</p>', fill: true, links: [{ page: 'p' }] })).toEqual({
      id: 't', type: 'note', style: 'text', ...geo, html: '<p>a</p>', fill: true, links: [{ page: 'p' }],
    });
    expect(cleanBlock({ id: 's', type: 'sticky', ...geo, html: '<p>b</p>', tint: 'blue' })).toMatchObject({ type: 'note', style: 'sticky', html: '<p>b</p>', tint: 'blue' });
    expect(cleanBlock({ id: 'c', type: 'code', ...geo, code: 'x = 1' })).toMatchObject({ type: 'note', style: 'code', code: 'x = 1', html: '' });
  });
  it('a stored page with all three comes out as notes', () => {
    const p = normalizePage({ id: 'p', title: 'T', groupId: null, tags: [], arrows: [], created: 1, updated: 1, rev: 1, blocks: [
      { id: 'a', type: 'text', ...geo, html: '<p>a</p>' }, { id: 'b', type: 'sticky', ...geo, html: '' }, { id: 'c', type: 'code', ...geo, code: 'z' },
    ] as never });
    expect(p.blocks.map((b) => [b.type, (b as NoteBlock).style])).toEqual([['note', 'text'], ['note', 'sticky'], ['note', 'code']]);
  });
  it('repairs a bad style and stray fields, and leaves other boxes alone', () => {
    expect(cleanBlock({ id: 'n', type: 'note', style: 'weird', ...geo, html: 5 })).toMatchObject({ style: 'text', html: '' });
    expect(cleanBlock({ id: 'n', type: 'note', style: 'text', ...geo, html: '<p>x</p>', code: 'old' })).not.toHaveProperty('code');
    expect(legacyNote({ type: 'table' })).toEqual({ type: 'table' });
  });
  it('is searched and named by what it says', () => {
    expect(blockPlainText(note({ style: 'code', html: '', code: 'run()' }))).toBe('run()');
    expect(noteText(note())).toBe('Hello');
    expect(kindClass(note({ style: 'sticky' }))).toBe('sticky');
    expect(kindClass({ type: 'table' })).toBe('table');
  });
});

describe('switching a note between styles', () => {
  it('keeps the words, drops formatting going to code, and wraps lines coming back', () => {
    const n = note({ html: '<h1>Title</h1><p>line two</p>' });
    expect(losesFormatting(n, 'code')).toBe(true);
    expect(losesFormatting(note(), 'code')).toBe(false);
    expect(losesFormatting(n, 'sticky')).toBe(false);
    setNoteStyle(n, 'code');
    expect(n).toMatchObject({ style: 'code', code: 'Title\nline two', html: '' });
    setNoteStyle(n, 'text');
    expect(n.html).toBe('<p>Title<br>line two</p>');
    expect(n).not.toHaveProperty('code');
  });
  it('drops the background when it leaves text', () => {
    const n = note({ fill: true });
    setNoteStyle(n, 'sticky');
    expect(n).not.toHaveProperty('fill');
  });
});

describe('a note on the page', () => {
  const page = (blocks: Block[]): Page => ({ id: 'p', title: 'T', groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 1 });
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    useNotes.setState({ pages: { p: page([note({ html: '<p>Hello</p>' })]) } });
  });
  it('is created in each style by the one add action', () => {
    const t = addBlock('p', 'text', { x: 0, y: 0 });
    const s = addBlock('p', 'sticky', { x: 0, y: 0 });
    const c = addBlock('p', 'code', { x: 0, y: 0 });
    const by = (id: string) => useNotes.getState().pages.p.blocks.find((b) => b.id === id) as NoteBlock;
    expect([by(t), by(s), by(c)].map((b) => [b.type, b.style])).toEqual([['note', 'text'], ['note', 'sticky'], ['note', 'code']]);
    expect(by(c).code).toBe('');
  });
  it('changes style as one undo step, a sticky taking its size and colour', () => {
    setNoteStyleOf('p', 'n', 'sticky');
    let n = useNotes.getState().pages.p.blocks[0] as NoteBlock;
    expect([n.style, n.w, n.h, n.tint]).toEqual(['sticky', 200, 200, 'yellow']);
    undo('p');
    n = useNotes.getState().pages.p.blocks[0] as NoteBlock;
    expect([n.style, n.w, n.h]).toEqual(['text', 100, 40]);
  });
  it('is not changed when locked', () => {
    useNotes.setState({ pages: { p: page([note({ locked: true })]) } });
    setNoteStyleOf('p', 'n', 'code');
    expect((useNotes.getState().pages.p.blocks[0] as NoteBlock).style).toBe('text');
  });
});

describe('changing several notes at once', () => {
  const page = (blocks: Block[]): Page => ({ id: 'p', title: 'T', groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 1 });
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    useNotes.setState({
      pages: { p: page([note({ id: 'a' }), note({ id: 'b', style: 'sticky', tint: 'red' }), note({ id: 'c', locked: true }), { id: 't', type: 'table', ...geo, z: 1, rows: [['x']] } as Block]) },
    });
  });
  it('is one undo step, skipping locked boxes, non-notes and notes already in that style', async () => {
    const { setNoteStyles } = await import('../src/store/notes');
    setNoteStyles('p', ['a', 'b', 'c', 't'], 'code');
    const get = (id: string) => useNotes.getState().pages.p.blocks.find((b) => b.id === id) as NoteBlock;
    expect([get('a').style, get('b').style, get('c').style, get('t').type]).toEqual(['code', 'code', 'text', 'table']);
    undo('p');
    expect([get('a').style, get('b').style]).toEqual(['text', 'sticky']);
  });
  it('cycles text, sticky, code, text', async () => {
    const { nextStyle } = await import('../src/lib/note');
    expect(['text', 'sticky', 'code'].map((s) => nextStyle(s as 'text'))).toEqual(['sticky', 'code', 'text']);
  });
});
