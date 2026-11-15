import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { docBlock, pageApp, sheetBlock, slidesOf } from '../src/lib/office/app';
import { formatCells, insertLines } from '../src/lib/office/sheetModel';
import { addSlide, copySlide, createOfficePage, editSheet, gridOf, moveSlideBy, removeSlide, setDocSize, setFreeze, setSlide } from '../src/store/office';
import { undo, useNotes } from '../src/store/notes';

const page = (id: string) => useNotes.getState().pages[id];

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  useNotes.setState({ pages: {}, filter: { kind: 'all' } } as never);
});

describe('making Workspace pages', () => {
  it('each kind starts as an ordinary page with the right marked box, and no edges', () => {
    const d = createOfficePage('doc', 'doc-report')!;
    const s = createOfficePage('sheet', 'sheet-budget')!;
    const p = createOfficePage('slides', 'slides-pitch')!;
    expect([pageApp(d), pageApp(s), pageApp(p)]).toEqual(['doc', 'sheet', 'slides']);
    expect([d.sheet, s.sheet, p.sheet]).toEqual([null, null, null]);
    expect(docBlock(d.blocks)!.html).toContain('Summary');
    expect(slidesOf(p.blocks).length).toBeGreaterThan(3);
    expect(d.title).toBe('Report');
  });
  it('a starter of another kind is refused, a missing one gives that kind\'s first', () => {
    expect(createOfficePage('doc', 'sheet-budget')).toBeNull();
    expect(pageApp(createOfficePage('sheet')!)).toBe('sheet');
  });
});

describe('a spreadsheet page', () => {
  it('changes cells as one undo step, keeping formats, widths and freeze', () => {
    const s = createOfficePage('sheet', 'sheet-blank')!;
    editSheet(s.id, (g) => ({ ...g, rows: [['1', '2', '=A1+B1']], colW: { '0': 140 } }));
    setFreeze(s.id, 1);
    editSheet(s.id, (g) => formatCells(g, { r1: 0, c1: 0, r2: 0, c2: 0 }, { b: 1 }));
    const b = sheetBlock(page(s.id).blocks)!;
    expect([b.rows[0], b.calc?.page, b.calc?.freeze, b.calc?.colW, b.calc?.fmt?.A1]).toEqual([['1', '2', '=A1+B1'], true, 1, { '0': 140 }, { b: 1 }]);
    undo(s.id); // the bold
    expect(sheetBlock(page(s.id).blocks)!.calc?.fmt).toBeUndefined();
    expect(sheetBlock(page(s.id).blocks)!.calc?.freeze).toBe(1);
  });
  it('formulas follow an inserted row', () => {
    const s = createOfficePage('sheet', 'sheet-blank')!;
    editSheet(s.id, (g) => ({ ...g, rows: [['1'], ['=A1*2']] }));
    editSheet(s.id, (g) => insertLines(g, 'row', 0));
    expect(gridOf(page(s.id))!.rows.map((r) => r[0])).toEqual(['', '1', '=A2*2']);
  });
  it('freeze can be turned off', () => {
    const s = createOfficePage('sheet', 'sheet-blank')!;
    setFreeze(s.id, 1);
    setFreeze(s.id, 0);
    expect(sheetBlock(page(s.id).blocks)!.calc).toEqual({ page: true });
  });
});

describe('a document page', () => {
  it('changes paper size and the width of the sheet with it', () => {
    const d = createOfficePage('doc', 'doc-blank')!;
    setDocSize(d.id, 'a4');
    expect(docBlock(page(d.id).blocks)).toMatchObject({ w: 794, doc: { page: true, size: 'a4' } });
  });
});

describe('a presentation page', () => {
  it('adds, copies, moves and deletes slides, each one undo step', () => {
    const p = createOfficePage('slides', 'slides-blank')!;
    expect(slidesOf(page(p.id).blocks)).toHaveLength(1);
    const second = addSlide(p.id, 'content')!;
    expect(slidesOf(page(p.id).blocks).map((s) => s.id)[1]).toBe(second);
    const copy = copySlide(p.id, second)!;
    expect(slidesOf(page(p.id).blocks)).toHaveLength(3);
    moveSlideBy(p.id, copy, -1);
    expect(slidesOf(page(p.id).blocks).map((s) => s.id)[1]).toBe(copy);
    removeSlide(p.id, copy);
    expect(slidesOf(page(p.id).blocks)).toHaveLength(2);
    undo(p.id);
    expect(slidesOf(page(p.id).blocks)).toHaveLength(3);
  });
  it('keeps speaker notes and background on the slide', () => {
    const p = createOfficePage('slides', 'slides-blank')!;
    const id = slidesOf(page(p.id).blocks)[0].id;
    setSlide(p.id, id, { notes: 'hello', bg: 'blue' });
    expect(slidesOf(page(p.id).blocks)[0].slide).toEqual({ notes: 'hello', bg: 'blue' });
  });
  it('removing the only slide does nothing, and no undo step is made', () => {
    const p = createOfficePage('slides', 'slides-blank')!;
    const before = page(p.id).blocks;
    removeSlide(p.id, slidesOf(before)[0].id);
    expect(page(p.id).blocks).toBe(before);
  });
});

describe('the starters look right', () => {
  it('the budget\'s total row is in the same currency format as the rows above it', async () => {
    const { starterById } = await import('../src/lib/office/starters');
    const t = sheetBlock(starterById('sheet-budget')!.build('t').blocks as never)!;
    for (const c of ['B2', 'C5', 'D8', 'B9', 'C9', 'D9']) expect(t.calc?.fmt?.[c], c).toMatchObject({ nf: 'cur', dec: 0 });
    expect(t.calc?.fmt?.A9).toMatchObject({ b: 1 });
  });
});
