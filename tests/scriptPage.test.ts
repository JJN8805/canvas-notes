import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { pageApp, scriptBlock } from '../src/lib/office/app';
import { normalizePage } from '../src/storage/types';
import { setNoteStyle } from '../src/lib/note';
import { parseScript, serializeScript } from '../src/lib/script/fountain';
import { SCRIPT_STARTERS } from '../src/lib/script/starters';
import { layoutPages } from '../src/lib/script/layout';
import { FORMATS } from '../src/lib/script/model';
import { createOfficePage } from '../src/store/office';
import { setScriptFormat, writeScript } from '../src/store/script';
import { undo, useNotes } from '../src/store/notes';
import type { NoteBlock, Page } from '../src/types';
import { isFeatureOn } from '../src/lib/features';

const page = (id: string) => useNotes.getState().pages[id];

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  useNotes.setState({ pages: {}, filter: { kind: 'all' } } as never);
});

describe('script pages', () => {
  it('every starter makes a script page with Fountain that reads back as the same script', () => {
    for (const s of SCRIPT_STARTERS) {
      const p = createOfficePage('script', s.id)!;
      expect(pageApp(p)).toBe('script');
      expect(p.sheet).toBeNull();
      const b = scriptBlock(p.blocks)!;
      expect(b.style).toBe('code');
      expect(b.script).toEqual({ page: true, format: s.format });
      expect(serializeScript(parseScript(b.code!))).toBe(b.code);
      expect(layoutPages(parseScript(b.code!).els, s.format).length).toBeGreaterThan(0);
    }
  });

  it('there is a starter for every layout', () => {
    expect(new Set(SCRIPT_STARTERS.map((s) => s.format))).toEqual(new Set(Object.keys(FORMATS)));
  });

  it('typing is one undo step per kind and the layout is a step of its own', () => {
    const p = createOfficePage('script', 'script-blank')!;
    const before = scriptBlock(page(p.id).blocks)!.code;
    writeScript(p.id, 'INT. A - DAY\n', 'script');
    writeScript(p.id, 'INT. A - DAY\n\nHello.\n', 'script');
    expect(scriptBlock(page(p.id).blocks)!.code).toContain('Hello.');
    setScriptFormat(p.id, 'stage');
    expect(scriptBlock(page(p.id).blocks)!.script!.format).toBe('stage');
    undo(p.id);
    expect(scriptBlock(page(p.id).blocks)!.script!.format).toBe('screenplay');
    undo(p.id);
    expect(scriptBlock(page(p.id).blocks)!.code).toBe(before);
  });

  it('refuses a format it does not know', () => {
    const p = createOfficePage('script', 'script-blank')!;
    setScriptFormat(p.id, 'hologram' as never);
    expect(scriptBlock(page(p.id).blocks)!.script!.format).toBe('screenplay');
  });
});

describe('a stored script is repaired when read', () => {
  const stored = (b: Record<string, unknown>) => normalizePage({ id: 'p', title: 't', blocks: [{ id: 'b', type: 'note', x: 0, y: 0, w: 100, h: 100, z: 1, ...b }], arrows: [], created: 1, updated: 1, rev: 0 } as unknown as Page);
  it('keeps a good marker on a code note', () => {
    expect((stored({ style: 'code', code: 'x', script: { page: true, format: 'tv' } }).blocks[0] as NoteBlock).script).toEqual({ page: true, format: 'tv' });
  });
  it('drops an unknown format, extra fields, and a marker on any other style', () => {
    expect((stored({ style: 'code', code: 'x', script: { page: true, format: 'nope' } }).blocks[0] as NoteBlock).script).toBeUndefined();
    expect((stored({ style: 'code', code: 'x', script: { page: true, format: 'tv', evil: '<img onerror=1>' } }).blocks[0] as NoteBlock).script).toEqual({ page: true, format: 'tv' });
    expect((stored({ style: 'text', html: '<p>x</p>', script: { page: true, format: 'tv' } }).blocks[0] as NoteBlock).script).toBeUndefined();
  });
  it('leaving code style ends being a script', () => {
    const b = { type: 'note', style: 'code', code: 'a', html: '', script: { page: true, format: 'tv' } } as unknown as NoteBlock;
    setNoteStyle(b, 'text');
    expect(b.script).toBeUndefined();
  });
});

describe('the Scripts feature', () => {
  it('can be switched off alone, and is off in the profiles that only have Word and Excel', () => {
    expect(isFeatureOn([], 'script')).toBe(true);
    expect(isFeatureOn(['script'], 'script')).toBe(false);
    expect(isFeatureOn(['script'], 'doc')).toBe(true);
  });
});
