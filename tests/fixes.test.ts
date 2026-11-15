import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/components/library/Thumbnail', () => ({ StaticBody: () => null }));
vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { applyChanges } from '../src/addons/ai/applyEdits';
import { buildEditableContext, propose, type EditOp } from '../src/addons/ai/edits';
import { applyTidy, addBlock, createPage, duplicateBlocks, setLocked, undo, useNotes } from '../src/store/notes';
import { history } from '../src/store/history';
import { tidyPage } from '../src/lib/tidy';
import { selectableIds } from '../src/components/editor/actions';
import type { Block } from '../src/types';

const text = (id: string, x: number, y: number, extra: Partial<Block> = {}): Block => ({ id, type: 'note', style: 'text', x, y, w: 200, h: 50, z: 1, html: `<p>${id}</p>`, ...extra }) as Block;
const frame = (id: string, extra: Partial<Block> = {}): Block => ({ id, type: 'frame', x: 0, y: 0, w: 400, h: 300, z: 0, title: '', color: 'teal', collapsed: false, ...extra }) as Block;
const at = (pageId: string, id: string) => useNotes.getState().pages[pageId].blocks.find((b) => b.id === id)!;

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useNotes.setState({ filter: { kind: 'all' }, pages: {} });
});

describe('Tidy leaves locked boxes where they are', () => {
  it('moves the free box out of the way, never the locked one', () => {
    const p = createPage({ blocks: [text('free', 0, 0), text('lock', 10, 5, { locked: true })] });
    const r = tidyPage(useNotes.getState().pages[p.id]);
    expect(r.moves.has('lock')).toBe(false);
    expect(r.moves.has('free')).toBe(true); // it is the one that gets separated
    applyTidy(p.id, r);
    expect([at(p.id, 'lock').x, at(p.id, 'lock').y]).toEqual([10, 5]);
  });
  it('lines free boxes up with a locked one rather than the other way round', () => {
    const p = createPage({ blocks: [text('lock', 100, 400, { locked: true }), text('a', 110, 0)] });
    const r = tidyPage(useNotes.getState().pages[p.id]);
    expect(r.moves.get('a')?.x).toBe(100);
    expect(r.moves.has('lock')).toBe(false);
  });
  it('a frame holding a locked box stays put, with everything in it', () => {
    const p = createPage({ blocks: [frame('f'), text('in', 20, 60, { frameId: 'f', locked: true }), text('other', 10, 20)] });
    const r = tidyPage(useNotes.getState().pages[p.id]);
    expect(r.moves.has('f')).toBe(false);
    expect(r.moves.has('in')).toBe(false);
  });
  it('a proposal made before the box was locked still cannot move it', () => {
    const p = createPage({ blocks: [text('a', 0, 0), text('b', 10, 5)] });
    const r = tidyPage(useNotes.getState().pages[p.id]);
    expect(r.moves.size).toBeGreaterThan(0);
    const moving = [...r.moves.keys()][0];
    const before = { x: at(p.id, moving).x, y: at(p.id, moving).y };
    setLocked(p.id, [moving], true);
    // the lock changes nothing about positions, so the proposal's basis still matches: applying must skip the locked box
    applyTidy(p.id, r);
    expect({ x: at(p.id, moving).x, y: at(p.id, moving).y }).toEqual(before);
  });
});

describe('the assistant treats a locked box as read only', () => {
  const pageWith = (locked: boolean) => createPage({ blocks: [text('t', 0, 0, { html: '<p>Helo</p>', locked })] });
  const ops: EditOp[] = [{ kind: 'text', box: 'b1', markdown: 'Hello' }];
  it('gives a locked box no label, so it cannot be proposed', () => {
    const p = pageWith(true);
    const ctx = buildEditableContext(useNotes.getState().pages[p.id]);
    expect(Object.keys(ctx.aliases)).toEqual([]);
    expect(ctx.text).toMatch(/read only/);
  });
  it('refuses an edit to a box locked after the proposal was made', () => {
    const p = pageWith(false);
    const { aliases } = buildEditableContext(useNotes.getState().pages[p.id]);
    const changes = propose(ops, aliases, useNotes.getState().pages[p.id].blocks);
    setLocked(p.id, ['t'], true);
    const report = applyChanges(p.id, changes, aliases);
    expect(report.applied).toBe(0);
    expect(report.skipped).toBe(1);
    expect((at(p.id, 't') as { html: string }).html).toBe('<p>Helo</p>');
  });
  it('refuses a delete of a box locked after the proposal was made', () => {
    const p = pageWith(false);
    const { aliases } = buildEditableContext(useNotes.getState().pages[p.id]);
    const changes = propose([{ kind: 'delete', box: 'b1' }], aliases, useNotes.getState().pages[p.id].blocks);
    setLocked(p.id, ['t'], true);
    expect(applyChanges(p.id, changes, aliases).applied).toBe(0);
    expect(useNotes.getState().pages[p.id].blocks).toHaveLength(1);
  });
});

describe('copying a frame', () => {
  it('Ctrl+D copies what is inside it, still grouped in the copy', () => {
    const p = createPage({ blocks: [frame('f'), text('in', 20, 60, { frameId: 'f' })] });
    const copies = duplicateBlocks(p.id, ['f']);
    expect(copies).toHaveLength(1); // the copy of what was asked for, so it is what gets selected
    const blocks = useNotes.getState().pages[p.id].blocks;
    expect(blocks).toHaveLength(4);
    const copyChild = blocks.find((b) => b.id !== 'in' && (b.type === 'note' && b.style === 'text'))!;
    expect(copyChild.frameId).toBe(copies[0]);
  });
  it('is the same whether or not the contents were selected too', () => {
    const p = createPage({ blocks: [frame('f'), text('in', 20, 60, { frameId: 'f' })] });
    duplicateBlocks(p.id, ['f', 'in']);
    expect(useNotes.getState().pages[p.id].blocks).toHaveLength(4);
  });
});

describe('Tab to branch', () => {
  it('adds the box and its arrow as ONE undo step', () => {
    const p = createPage({ blocks: [text('a', 0, 0)] });
    history.clear(p.id);
    const id = addBlock(p.id, 'sticky', { x: 300, y: 0 }, {}, { arrowFrom: 'a' });
    const page = useNotes.getState().pages[p.id];
    expect(page.arrows).toHaveLength(1);
    expect(page.arrows[0]).toMatchObject({ from: 'a', to: id });
    undo(p.id);
    const after = useNotes.getState().pages[p.id];
    expect(after.blocks).toHaveLength(1);
    expect(after.arrows).toHaveLength(0);
  });
  it('ignores an arrow from a box that does not exist', () => {
    const p = createPage({ blocks: [text('a', 0, 0)] });
    addBlock(p.id, 'sticky', { x: 300, y: 0 }, {}, { arrowFrom: 'ghost' });
    expect(useNotes.getState().pages[p.id].arrows).toHaveLength(0);
  });
});

describe('Select all', () => {
  it('skips what a collapsed frame hides, the same for the keyboard and the menu', () => {
    const blocks = [frame('f', { collapsed: true }), text('hidden', 20, 60, { frameId: 'f' }), text('visible', 500, 0)];
    expect(selectableIds(blocks).sort()).toEqual(['f', 'visible']);
  });
});

describe('a page made from a template', () => {
  it('keeps the size the template was saved with: an infinite page makes an infinite template makes an infinite page', async () => {
    const { createPageFromTemplate, saveAsTemplate } = await import('../src/store/notes');
    const inf = createPage({ sheet: null, blocks: [text('far', 3000, 2000)] });
    const tpl = saveAsTemplate(inf.id, 'Wide')!;
    expect(createPageFromTemplate(tpl.id)!.sheet).toBeNull();
    const finite = createPage({ blocks: [text('a', 0, 0)] });
    const tpl2 = saveAsTemplate(finite.id, 'Sheet')!;
    expect(createPageFromTemplate(tpl2.id)!.sheet).toMatchObject({ w: expect.any(Number), h: expect.any(Number) });
  });
  it('the mind map starts infinite, as its text says; the other shipped templates are fitted sheets', async () => {
    const { MORE_IDS } = await import('../src/lib/moreTemplates');
    const { BUILTIN_IDS } = await import('../src/lib/builtinTemplates');
    const { createPageFromTemplate } = await import('../src/store/notes');
    const mk = (id: string) => useNotes.setState((s) => ({ pages: { ...s.pages, [id]: { id, kind: 'template', title: id, groupId: null, tags: [], blocks: [text('x', 3000, 100)], arrows: [], created: 1, updated: 1, rev: 1, sheet: null } } }));
    mk(MORE_IDS.mindmap);
    mk(BUILTIN_IDS.meeting);
    expect(createPageFromTemplate(MORE_IDS.mindmap)!.sheet).toBeNull();
    expect(createPageFromTemplate(BUILTIN_IDS.meeting)!.sheet).not.toBeNull();
  });
});
