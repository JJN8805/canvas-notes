import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);
vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, useUi: { getState: () => ({}) } }));

import { createTauriStorage } from '../src/storage/tauri';
import type { NotesStorage } from '../src/storage/types';
import { MORE_IDS, field } from '../src/lib/moreTemplates';
import { builder } from '../src/lib/templateKit';
import { BUILTIN_IDS, builtinTemplates, SEED_ETAG, SEED_ETAG_2, seedBuiltinTemplates } from '../src/lib/builtinTemplates';
import { libraryPages, resolveDailyTemplate, templatesOf } from '../src/lib/pages';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import { history } from '../src/store/history';
import { loadPrefs, setDailyTemplate, usePrefs } from '../src/store/prefs';
import { createPageFromTemplate, createTemplate, deleteTemplate, duplicateTemplate, renameTemplate, useNotes } from '../src/store/notes';
import type { Page } from '../src/types';

const ALL = builtinTemplates().length;
const asPages = () => Object.fromEntries(builtinTemplates().map((r) => [r.id, { ...r, rev: 0 } as Page]));

describe('the starter templates', () => {
  it('start with the original six, then the form, board and planner templates, as templates, named and filled in', () => {
    const t = builtinTemplates();
    expect(t.slice(0, 6).map((x) => x.title)).toEqual(['Meeting notes', 'Weekly review', 'Project plan', 'To-do list', 'Brainstorm board', 'Daily page']);
    expect(t.slice(0, 6).map((x) => x.id)).toEqual(Object.values(BUILTIN_IDS));
    expect(t.slice(6).map((x) => x.id)).toEqual(Object.values(MORE_IDS));
    expect(t.map((x) => x.title)).toEqual(expect.arrayContaining(['Form builder', 'Registration form', 'Feedback survey', 'Mind map', 'Kanban board']));
    expect(new Set(t.map((x) => x.id)).size).toBe(t.length);
    for (const x of t) {
      expect(x).toMatchObject({ kind: 'template', deleted: false, groupId: null, tags: [] });
      expect(x.etag).toBe(Object.values(BUILTIN_IDS).includes(x.id as never) ? SEED_ETAG : SEED_ETAG_2);
      expect(x.blocks.length).toBeGreaterThan(2);
    }
  });

  it('hold together: unique ids, frames that exist, arrows between real boxes, nothing off the page', () => {
    for (const x of builtinTemplates()) {
      const ids = x.blocks.map((b) => b.id);
      expect(new Set(ids).size, x.title).toBe(ids.length);
      for (const b of x.blocks) {
        if (b.frameId) expect(x.blocks.find((f) => f.id === b.frameId)?.type, `${x.title} frame`).toBe('frame');
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
      }
      for (const a of x.arrows) expect(ids).toContain(a.from) && expect(ids).toContain(a.to);
    }
  });

  it('put the brainstorm stickies inside frames, and use the note colours', () => {
    const b = builtinTemplates().find((x) => x.id === BUILTIN_IDS.brainstorm)!;
    const stickies = b.blocks.filter((x) => x.type === 'sticky');
    expect(stickies.length).toBeGreaterThanOrEqual(4);
    expect(stickies.every((s) => !!s.frameId && !!s.tint)).toBe(true);
    expect(b.blocks.filter((x) => x.type === 'frame').length).toBeGreaterThanOrEqual(3);
  });

  it('have the same ids and contents every time they are built', () => {
    const a = builtinTemplates(1).map((r) => JSON.stringify(r));
    const b = builtinTemplates(1).map((r) => JSON.stringify(r));
    expect(a).toEqual(b);
  });

  it('make independent pages: a new page from each has all-new ids', () => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useNotes.setState({ filter: { kind: 'all' }, pages: asPages() });
    for (const id of Object.values(BUILTIN_IDS)) {
      const tpl = useNotes.getState().pages[id];
      const p = createPageFromTemplate(id)!;
      const old = new Set(tpl.blocks.map((b) => b.id));
      expect(p.blocks.some((b) => old.has(b.id)), id).toBe(false);
      expect(p.blocks).toHaveLength(tpl.blocks.length);
    }
  });
});

describe('form fields', () => {
  it('draw a label and an input, and report where the next field starts', () => {
    const b = builder('t');
    const next = field(b, 100, 200, 300, 'Name', 'short');
    expect(b.blocks.map((x) => x.type)).toEqual(['text', 'text']);
    expect(b.blocks[1]).toMatchObject({ x: 100, y: 240, w: 300, fill: true });
    expect(next).toBeGreaterThan(b.blocks[1].y + b.blocks[1].h);
  });

  it('give choices one tick box each, and do not overlap the following field', () => {
    const b = builder('t');
    const next = field(b, 0, 0, 300, 'Pick', 'choice', undefined, ['a', 'b']);
    expect(b.blocks[1]).toMatchObject({ type: 'checklist' });
    expect((b.blocks[1] as { items: unknown[] }).items).toHaveLength(2);
    expect(next).toBeGreaterThan(40 + 2 * 32);
  });

  it('make the form builder carry every kind of field plus a flow of arrows', () => {
    const f = builtinTemplates().find((x) => x.id === MORE_IDS.formBuilder)!;
    expect(f.blocks.filter((x) => x.type === 'text' && x.fill).length).toBeGreaterThanOrEqual(7);
    expect(f.blocks.some((x) => x.type === 'checklist')).toBe(true);
    expect(f.arrows.length).toBeGreaterThanOrEqual(2);
  });

  it('draw inputs as filled text boxes and size every frame to its contents', () => {
    const all = builtinTemplates();
    const f = all.find((x) => x.id === MORE_IDS.formBuilder)!;
    const inputs = f.blocks.filter((x) => x.type === 'text' && x.fill);
    expect(inputs.length).toBeGreaterThanOrEqual(7);
    expect(f.blocks.some((x) => x.type === 'table')).toBe(false);
    // no frame leaves a big empty strip at the bottom: its boxes reach close to its lower edge
    // (the Kanban board and Cornell notes are deliberately roomy: their frames are meant to be filled)
    for (const t of all.filter((x) => Object.values(MORE_IDS).includes(x.id as never) && ![MORE_IDS.kanban, MORE_IDS.cornell].includes(x.id as never))) {
      for (const fr of t.blocks.filter((x) => x.type === 'frame')) {
        const kids = t.blocks.filter((x) => x.frameId === fr.id);
        if (!kids.length) continue;
        const reach = Math.max(...kids.map((k) => k.y + (k.type === 'sticky' ? k.h : k.type === 'table' ? k.h + 24 * k.rows.length : k.type === 'checklist' ? k.h + 32 * k.items.length : k.h)));
        expect(fr.y + fr.h - reach, `${t.title} / ${fr.type === 'frame' ? fr.title : ''}`).toBeLessThan(220);
      }
    }
  });

  it('keep a mind map wide and connected', () => {
    const m = builtinTemplates().find((x) => x.id === MORE_IDS.mindmap)!;
    expect(Math.max(...m.blocks.map((x) => x.x + x.w))).toBeGreaterThan(1800);
    expect(m.arrows.length).toBeGreaterThanOrEqual(12);
  });
});

describe('seeding', () => {
  let a: NotesStorage;
  let b: NotesStorage;
  beforeEach(async () => {
    useDevice('a');
    a = await createTauriStorage();
    useDevice('b');
    b = await createTauriStorage();
    useDevice('a');
  });

  it('adds the six once, and not again on the next start', async () => {
    expect(await seedBuiltinTemplates(a)).toBe(ALL);
    expect(await seedBuiltinTemplates(a)).toBe(0);
    const pages = (await a.loadAll()).pages;
    expect(pages.filter((p) => p.kind === 'template')).toHaveLength(ALL);
  });

  it('gives an app that already has the first six only the new ones, and only once', async () => {
    await a.setSetting('templates.seeded', '1'); // what an earlier version left behind
    for (const rec of builtinTemplates().slice(0, 6)) await a.sync.applyRemote('page', rec);
    await a.deletePage(BUILTIN_IDS.todo); // the user removed one of the originals
    expect(await seedBuiltinTemplates(a)).toBe(ALL - 6);
    expect(await seedBuiltinTemplates(a)).toBe(0);
    const ids = (await a.loadAll()).pages.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(Object.values(MORE_IDS)));
    expect(ids).not.toContain(BUILTIN_IDS.todo);
  });

  it('replaces an unedited copy of the first version of a new starter with the redrawn one, once, and leaves edited or deleted ones alone', async () => {
    const old = builtinTemplates().filter((r) => !Object.values(BUILTIN_IDS).includes(r.id as never));
    await a.setSetting('templates.seeded', '1');
    await a.setSetting('templates.seeded.2', '1'); // an app that already ran the first version of the second batch
    for (const r of old) await a.sync.applyRemote('page', { ...r, etag: 'viewed-' + r.id, title: r.title + ' (old)', blocks: [] });
    for (const r of builtinTemplates().slice(0, 6)) await a.sync.applyRemote('page', r);
    // one was edited by the user, one deleted
    const edited = old[0].id;
    const gone = old[1].id;
    await a.sync.applyRemote('page', { ...old[0], etag: 'user-edit', title: 'Mine', blocks: [], updated: old[0].created + 5000 });
    await a.deletePage(gone);

    await seedBuiltinTemplates(a);
    const pages = Object.fromEntries((await a.loadAll()).pages.map((p) => [p.id, p]));
    expect(pages[edited].title).toBe('Mine');
    expect(pages[gone]).toBeUndefined();
    const refreshed = pages[old[2].id];
    expect(refreshed.title).not.toContain('(old)');
    expect(refreshed.blocks.length).toBeGreaterThan(0);

    // opening one only re-saves its measured heights, so it still counts as unedited
    expect(pages[old[3].id].title).not.toContain('(old)');

    // and only once: a later edit or revert is never undone
    await a.sync.applyRemote('page', { ...old[2], etag: 'again', title: 'Back to the first version', blocks: [] });
    await seedBuiltinTemplates(a);
    expect((await a.loadPage(old[2].id))!.title).toBe('Back to the first version');
  });

  it('never brings back a starter that was deleted', async () => {
    await seedBuiltinTemplates(a);
    await a.deletePage(BUILTIN_IDS.todo);
    await a.purgePage(BUILTIN_IDS.todo);
    await a.setSetting('templates.seeded', null); // as if the flag were lost
    expect(await seedBuiltinTemplates(a)).toBe(0);
    expect((await a.loadAll()).pages.some((p) => p.id === BUILTIN_IDS.todo)).toBe(false);
  });

  it('leaves existing pages alone', async () => {
    const res = await a.savePage({ id: 'mine', title: 'Mine', groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0 });
    expect(res.ok).toBe(true);
    await seedBuiltinTemplates(a);
    expect((await a.loadPage('mine'))?.title).toBe('Mine');
  });

  it('agrees across devices: seeding both makes no changes, conflicts or duplicates when they sync', async () => {
    useDevice('a');
    await seedBuiltinTemplates(a);
    useDevice('b');
    await seedBuiltinTemplates(b);
    const send = <T,>(req: SyncRequest) => {
      useDevice('a');
      return handleRequest(a.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
    };
    useDevice('b');
    const r = await syncWithLaptop(b.sync, send);
    expect(r).toEqual({ sent: 0, received: 0, conflicts: 0, images: 0 });
    useDevice('b');
    expect((await b.loadAll()).pages).toHaveLength(ALL);
  });

  it('syncs an edit to a starter without a conflict', async () => {
    useDevice('a');
    await seedBuiltinTemplates(a);
    useDevice('b');
    await seedBuiltinTemplates(b);
    useDevice('a');
    const cur = (await a.loadPage(BUILTIN_IDS.todo))!;
    await a.savePage({ ...cur, title: 'My to-dos' });
    const send = <T,>(req: SyncRequest) => {
      useDevice('a');
      return handleRequest(a.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
    };
    useDevice('b');
    const r = await syncWithLaptop(b.sync, send);
    expect(r.conflicts).toBe(0);
    useDevice('b');
    expect((await b.loadPage(BUILTIN_IDS.todo))?.title).toBe('My to-dos');
    expect((await b.loadAll()).pages).toHaveLength(ALL);
  });
});

describe('the daily template setting', () => {
  it('picks the chosen template, else the built-in Daily page, else blank', () => {
    const pages = asPages();
    expect(resolveDailyTemplate(pages, null)?.id).toBe(BUILTIN_IDS.daily);
    expect(resolveDailyTemplate(pages, BUILTIN_IDS.weekly)?.id).toBe(BUILTIN_IDS.weekly);
    expect(resolveDailyTemplate(pages, 'none')).toBeNull();
    expect(resolveDailyTemplate(pages, 'gone')?.id).toBe(BUILTIN_IDS.daily);
    delete pages[BUILTIN_IDS.daily];
    expect(resolveDailyTemplate(pages, null)).toBeNull();
    expect(resolveDailyTemplate({ p: { ...pages[BUILTIN_IDS.todo], id: 'p', kind: 'page' } as Page }, 'p')).toBeNull(); // a page is not a template
  });

  it('is remembered on this device', async () => {
    const data = new Map<string, string>();
    const s = {
      getSetting: async (k: string) => data.get(k) ?? null,
      setSetting: async (k: string, v: string | null) => void (v === null ? data.delete(k) : data.set(k, v)),
    };
    setDailyTemplate('tpl-weekly', s);
    await Promise.resolve();
    expect(data.get('daily.templateId')).toBe('tpl-weekly');
    usePrefs.setState({ dailyTemplate: null });
    await loadPrefs(s);
    expect(usePrefs.getState().dailyTemplate).toBe('tpl-weekly');
    setDailyTemplate(null, s);
    await Promise.resolve();
    expect(data.has('daily.templateId')).toBe(false);
  });
});

describe('managing templates', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    usePrefs.setState({ dailyTemplate: null });
    useNotes.setState({ filter: { kind: 'all' }, pages: { ...asPages(), p: { id: 'p', title: 'Real', groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 1 } } });
    history.clear(BUILTIN_IDS.todo);
  });

  it('renames a template, ignoring an empty name', () => {
    renameTemplate(BUILTIN_IDS.todo, '  Errands  ');
    expect(useNotes.getState().pages[BUILTIN_IDS.todo].title).toBe('Errands');
    renameTemplate(BUILTIN_IDS.todo, '   ');
    expect(useNotes.getState().pages[BUILTIN_IDS.todo].title).toBe('Errands');
    renameTemplate('p', 'Hijack'); // a page is not renamed through this
    expect(useNotes.getState().pages.p.title).toBe('Real');
  });

  it('duplicates a template as a new template', () => {
    const c = duplicateTemplate(BUILTIN_IDS.meeting)!;
    expect(c).toMatchObject({ kind: 'template', title: 'Meeting notes copy' });
    expect(c.id).not.toBe(BUILTIN_IDS.meeting);
    expect(templatesOf(useNotes.getState().pages)).toHaveLength(ALL + 1);
    expect(libraryPages(useNotes.getState().pages).map((x) => x.id)).toEqual(['p']);
  });

  it('makes a new empty template', () => {
    const t = createTemplate();
    expect(t).toMatchObject({ kind: 'template', title: 'New template', blocks: [] });
    expect(useNotes.getState().pages[t.id]).toBe(t);
  });

  it('deletes a template without touching pages made from it, and resets the daily setting if it was that one', async () => {
    const made = createPageFromTemplate(BUILTIN_IDS.daily)!;
    usePrefs.setState({ dailyTemplate: BUILTIN_IDS.daily });
    await deleteTemplate(BUILTIN_IDS.daily);
    expect(useNotes.getState().pages[BUILTIN_IDS.daily]).toBeUndefined();
    expect(useNotes.getState().pages[made.id]).toBeDefined();
    expect(usePrefs.getState().dailyTemplate).toBeNull();
  });

  it('refuses to delete an ordinary page this way', async () => {
    await deleteTemplate('p');
    expect(useNotes.getState().pages.p).toBeDefined();
  });
});

describe('storage of deleted templates', () => {
  it('purges a deleted template for good, keeping only the tombstone', async () => {
    useDevice('del');
    const s = await createTauriStorage();
    await seedBuiltinTemplates(s);
    await s.deletePage(BUILTIN_IDS.weekly);
    await s.purgePage(BUILTIN_IDS.weekly);
    const [rec] = await s.sync.getRecords('page', [BUILTIN_IDS.weekly]);
    expect(rec).toMatchObject({ deleted: true, title: '', blocks: [] });
    expect((await s.listTrash()).length).toBe(0);
  });
});
