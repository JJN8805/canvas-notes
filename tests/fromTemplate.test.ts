import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { createPageFromTemplate, saveAsTemplate, useNotes } from '../src/store/notes';
import { history } from '../src/store/history';
import { isTemplate, libraryPages, templatesOf } from '../src/lib/pages';
import type { Block, Page } from '../src/types';

const base = (extra: Partial<Page>): Page => ({ id: 'x', title: '', groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 1, ...extra });
const blocks = (): Block[] => [
  { id: 'f', type: 'frame', x: 0, y: 0, w: 400, h: 300, z: 0, title: 'Agenda', color: 'teal', collapsed: false } as Block,
  { id: 'a', type: 'text', x: 10, y: 40, w: 200, h: 40, z: 1, html: '<p>Notes</p>', frameId: 'f' } as Block,
  { id: 'c', type: 'checklist', x: 10, y: 120, w: 200, h: 40, z: 2, items: [{ id: 'i1', text: 'Do it', done: false }], frameId: 'f' } as Block,
  { id: 's', type: 'sticky', x: 300, y: 40, w: 200, h: 200, z: 3, html: '<p>Idea</p>', tint: 'pink' } as Block,
];
const arrows = () => [{ id: 'ar', from: 'a', to: 's', heads: 'one' as const, style: 'solid' as const, z: 1 }];
const pages = () => Object.values(useNotes.getState().pages);

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useNotes.setState({
    filter: { kind: 'all' },
    pages: {
      src: base({ id: 'src', title: 'Planning', groupId: 'g', tags: ['work'], blocks: blocks(), arrows: arrows() }),
      tpl: base({ id: 'tpl', kind: 'template', title: 'Meeting notes', color: 'blue', blocks: blocks(), arrows: arrows() }),
    },
  });
  history.clear('src');
});

describe('saving a page as a template', () => {
  it('keeps a template with the same layout, new ids, and none of the page’s group, tags or date', () => {
    const t = saveAsTemplate('src', 'Planning layout')!;
    expect(t).toMatchObject({ kind: 'template', title: 'Planning layout', groupId: null, tags: [], dailyDate: null });
    expect(t.id).not.toBe('src');
    expect(t.blocks).toHaveLength(4);
    expect(t.blocks.map((b) => b.id).some((id) => ['f', 'a', 'c', 's'].includes(id))).toBe(false);
    expect(t.blocks.map((b) => [b.type, b.x, b.y, b.w])).toEqual(blocks().map((b) => [b.type, b.x, b.y, b.w]));
    expect(t.arrows).toHaveLength(1);
    expect(useNotes.getState().pages[t.id]).toBe(t);
  });

  it('leaves the page itself untouched, and the template out of the library', () => {
    const before = useNotes.getState().pages.src;
    saveAsTemplate('src', 'Planning layout');
    expect(useNotes.getState().pages.src).toBe(before);
    expect(libraryPages(useNotes.getState().pages).map((p) => p.id).sort()).toEqual(['src']);
    expect(templatesOf(useNotes.getState().pages).map((p) => p.title)).toEqual(['Meeting notes', 'Planning layout']);
  });

  it('falls back to the page’s title, then a plain name, when none is given', () => {
    expect(saveAsTemplate('src', '  ')!.title).toBe('Planning');
    useNotes.setState((s) => ({ pages: { ...s.pages, empty: base({ id: 'empty' }) } }));
    expect(saveAsTemplate('empty', '')!.title).toBe('Untitled template');
    expect(saveAsTemplate('missing', 'x')).toBeNull();
  });
});

describe('creating a page from a template', () => {
  it('makes a separate page named after the template, with new ids that point at each other', () => {
    const p = createPageFromTemplate('tpl')!;
    expect(p).toMatchObject({ kind: 'page', title: 'Meeting notes', color: 'blue', dailyDate: null });
    expect(p.id).not.toBe('tpl');
    const tpl = useNotes.getState().pages.tpl;
    const used = new Set([...tpl.blocks.map((b) => b.id), ...tpl.arrows.map((a) => a.id)]);
    expect([...p.blocks.map((b) => b.id), ...p.arrows.map((a) => a.id)].some((id) => used.has(id))).toBe(false);
    const frame = p.blocks.find((b) => b.type === 'frame')!;
    expect(p.blocks.filter((b) => b.frameId).every((b) => b.frameId === frame.id)).toBe(true);
    expect(p.arrows[0]).toMatchObject({ from: p.blocks[1].id, to: p.blocks[3].id });
    const list = p.blocks.find((b) => b.type === 'checklist') as { items: { id: string }[] };
    expect(list.items[0].id).not.toBe('i1');
  });

  it('is independent: editing the page leaves the template alone, and the other way round', () => {
    const p = createPageFromTemplate('tpl')!;
    useNotes.setState((s) => {
      (s.pages[p.id].blocks[1] as { html: string }).html = '<p>changed</p>';
    });
    expect((useNotes.getState().pages.tpl.blocks[1] as { html: string }).html).toBe('<p>Notes</p>');
    useNotes.setState((s) => {
      s.pages.tpl.blocks = [];
    });
    expect(useNotes.getState().pages[p.id].blocks).toHaveLength(4);
  });

  it('can be made twice, giving two separate pages', () => {
    const a = createPageFromTemplate('tpl')!;
    const b = createPageFromTemplate('tpl')!;
    expect(a.id).not.toBe(b.id);
    expect(a.blocks.map((x) => x.id).some((id) => b.blocks.some((y) => y.id === id))).toBe(false);
  });

  it('starts in the group and tags of the current library view, like a blank page', () => {
    useNotes.setState({ filter: { kind: 'tag', tag: 'work' } });
    expect(createPageFromTemplate('tpl')!.tags).toEqual(['work']);
    useNotes.setState({ filter: { kind: 'group', id: 'g' } });
    expect(createPageFromTemplate('tpl')!.groupId).toBe('g');
  });

  it('gives a blank page for Blank, and nothing for a missing template or for an ordinary page', () => {
    const blank = createPageFromTemplate(null)!;
    expect(blank).toMatchObject({ title: '', blocks: [] });
    expect(isTemplate(blank)).toBe(false);
    expect(createPageFromTemplate('nope')).toBeNull();
    expect(createPageFromTemplate('src')).toBeNull(); // only templates can be copied this way
  });

  it('adds the page to the library but not another template', () => {
    const before = pages().length;
    const p = createPageFromTemplate('tpl')!;
    expect(pages()).toHaveLength(before + 1);
    expect(libraryPages(useNotes.getState().pages).some((x) => x.id === p.id)).toBe(true);
    expect(templatesOf(useNotes.getState().pages)).toHaveLength(1);
  });
});
