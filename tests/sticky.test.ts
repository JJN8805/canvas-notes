import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryGraph } from './graphdb';

vi.mock('../src/components/library/Thumbnail', () => ({ StaticBody: () => null }));
vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { GraphMirror, type LegacyPage } from '../src/graph/mirror';
import { blockPlainText } from '../src/graph/text';
import { pageToMarkdown } from '../src/export/export';
import { blockHeight, blockText, BLOCK_LABEL, isFixedHeight } from '../src/lib/util';
import { readFileSync } from 'node:fs';
import { DEFAULT_STICKY_COLOR, dragsStickyBody, isStickyKey, STICKY_SIZE, stickyCorner, tintVars } from '../src/lib/colors';
import { history } from '../src/store/history';
import { loadPrefs, rememberStickyColor, usePrefs } from '../src/store/prefs';
import { addBlock, BLOCK_DEFAULTS, setColor, undo, useNotes } from '../src/store/notes';
import type { Block, Page, StickyBlock } from '../src/types';

const sticky = (extra: Partial<StickyBlock> = {}): StickyBlock => ({ id: 's1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, z: 1, html: '<p>Buy milk</p>', tint: 'yellow', ...extra });
const page = (blocks: Block[]): Page => ({ id: 'p', title: 'T', groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 1 });

/** A settings store that remembers in memory. */
const settings = () => {
  const data = new Map<string, string>();
  return {
    data,
    getSetting: async (k: string) => data.get(k) ?? null,
    setSetting: async (k: string, v: string | null) => void (v === null ? data.delete(k) : data.set(k, v)),
  };
};

describe('sticky block', () => {
  beforeEach(() => usePrefs.setState({ stickyColor: null }));

  it('starts 200 x 200 in yellow, or in the last colour picked for a sticky', () => {
    expect(BLOCK_DEFAULTS.sticky()).toMatchObject({ w: 200, h: 200, html: '', tint: DEFAULT_STICKY_COLOR });
    expect(STICKY_SIZE).toBe(200);
    usePrefs.setState({ stickyColor: 'blue' });
    expect(BLOCK_DEFAULTS.sticky().tint).toBe('blue');
  });

  it('keeps its height like a picture, not a minimum height', () => {
    expect(isFixedHeight(sticky())).toBe(true);
    expect(blockHeight(sticky({ h: 200, ah: 400 }))).toBe(200);
    expect(BLOCK_LABEL.sticky).toBe('Sticky');
  });

  it('exposes its colour to CSS, and nothing when it has none', () => {
    expect(tintVars(sticky({ tint: 'pink' }))).toMatchObject({ '--tint': 'var(--n-pink)', '--tint-ink': 'var(--n-pink-ink)' });
    expect(tintVars(sticky({ tint: null }))).toBeUndefined();
    expect(tintVars(sticky({ tint: 'mauve' as never }))).toBeUndefined();
  });

  it('has searchable text', () => {
    expect(blockText(sticky()).trim()).toBe('Buy milk');
    expect(blockPlainText(sticky())).toBe('Buy milk');
  });

  it('is mirrored into the graph as a sticky block', async () => {
    const { repo } = await memoryGraph();
    const legacy: LegacyPage = { id: 'p', title: 'T', groupId: null, tags: [], blocks: [sticky()], arrows: [], created: 1 };
    await new GraphMirror(repo).page(legacy);
    const rows = await repo.listBlocks('p');
    expect(rows.map((r) => r.type)).toEqual(['sticky']);
    expect(rows[0].plain_text).toBe('Buy milk');
    expect(JSON.parse(rows[0].content).tint).toBe('yellow');
  });
});

describe('sticky Markdown export', () => {
  it('becomes a note line with its colour in a comment', () => {
    const md = pageToMarkdown(page([sticky()]), () => '');
    expect(md).toContain('<!-- sticky color: yellow -->\n> 📝 Buy milk');
  });

  it('quotes every line of a longer note, and leaves the comment out without a colour', () => {
    const md = pageToMarkdown(page([sticky({ html: '<p>One</p><p>Two</p>', tint: null })]), () => '');
    expect(md).toContain('> 📝 One');
    expect(md).toMatch(/> Two/);
    expect(md).not.toContain('<!--');
  });

  it('leaves an empty sticky out', () => {
    expect(pageToMarkdown(page([sticky({ html: '' })]), () => '')).not.toContain('📝');
  });
});

describe('the S shortcut', () => {
  const key = (k: string, extra: object = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
  it('is a plain S only', () => {
    expect(isStickyKey(key('s'))).toBe(true);
    expect(isStickyKey(key('S'))).toBe(true);
    expect(isStickyKey(key('s', { ctrlKey: true }))).toBe(false);
    expect(isStickyKey(key('s', { metaKey: true }))).toBe(false);
    expect(isStickyKey(key('s', { altKey: true }))).toBe(false);
    expect(isStickyKey(key('s', { shiftKey: true }))).toBe(false);
    expect(isStickyKey(key('s', { repeat: true }))).toBe(false);
    expect(isStickyKey(key('a'))).toBe(false);
  });

  it('centres the sticky on the pointer, on the grid, never at negative coordinates', () => {
    expect(stickyCorner({ x: 500, y: 300 })).toEqual({ x: 400, y: 200 });
    expect(stickyCorner({ x: 503, y: 297 })).toEqual({ x: 400, y: 200 });
    expect(stickyCorner({ x: 10, y: 20 })).toEqual({ x: 0, y: 0 });
  });
});

describe('remembering the last sticky colour', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    usePrefs.setState({ stickyColor: null });
    history.clear('p');
    useNotes.setState({ pages: { p: page([sticky({ tint: 'yellow' }), { id: 't', type: 'text', x: 0, y: 0, w: 100, h: 40, z: 1, html: '' } as Block]) } });
  });

  it('is saved and read back through settings', async () => {
    const s = settings();
    rememberStickyColor('green', s);
    expect(s.data.get('ui.stickyColor')).toBe('green');
    usePrefs.setState({ stickyColor: null });
    await loadPrefs(s);
    expect(usePrefs.getState().stickyColor).toBe('green');
  });

  it('ignores a damaged saved value', async () => {
    const s = settings();
    s.data.set('ui.stickyColor', 'mauve');
    await loadPrefs(s);
    expect(usePrefs.getState().stickyColor).toBeNull();
  });

  it('follows a colour picked for a sticky, but not one picked for another box', () => {
    setColor('p', ['t'], 'red');
    expect(usePrefs.getState().stickyColor).toBeNull();
    setColor('p', ['s1'], 'purple');
    expect(usePrefs.getState().stickyColor).toBe('purple');
    setColor('p', ['s1'], null); // "none" is not a colour to start new stickies with
    expect(usePrefs.getState().stickyColor).toBe('purple');
  });

  it('gives the next sticky that colour, and creating one is a single undo step', () => {
    setColor('p', ['s1'], 'orange');
    const id = addBlock('p', 'sticky', { x: 40, y: 40 });
    const made = useNotes.getState().pages.p.blocks.find((b) => b.id === id) as StickyBlock;
    expect(made).toMatchObject({ type: 'sticky', w: 200, h: 200, tint: 'orange', x: 40, y: 40 });
    expect(undo('p')).toBe(true);
    expect(useNotes.getState().pages.p.blocks.some((b) => b.id === id)).toBe(false);
  });
});

describe('moving a sticky', () => {
  const base = { type: 'sticky', pointerType: 'mouse', shiftKey: false, editing: false, onText: true };

  it('drags by its text with a mouse or pen, unless it is being edited', () => {
    expect(dragsStickyBody(base)).toBe(true);
    expect(dragsStickyBody({ ...base, pointerType: 'pen' })).toBe(true);
    expect(dragsStickyBody({ ...base, editing: true })).toBe(false);
  });

  it('leaves other boxes, touch, Shift-click and non-text areas alone', () => {
    expect(dragsStickyBody({ ...base, type: 'text' })).toBe(false);
    expect(dragsStickyBody({ ...base, pointerType: 'touch' })).toBe(false);
    expect(dragsStickyBody({ ...base, shiftKey: true })).toBe(false);
    expect(dragsStickyBody({ ...base, onText: false })).toBe(false);
  });

  it('is not clipped, so its move handle, edge band, dots and resize handle stay reachable', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const rule = css.match(/\n\.b-sticky \{[^}]*\}/)![0];
    expect(rule).not.toMatch(/overflow\s*:\s*hidden/);
  });
});
