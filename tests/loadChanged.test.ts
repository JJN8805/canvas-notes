import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { createWebStorage } from '../src/storage/web';
import type { NotesStorage } from '../src/storage/types';
import type { Page } from '../src/types';

const page = (id: string): Page => ({ id, title: id, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0 });

describe.each([
  ['desktop', async () => (useDevice('d'), createTauriStorage())],
  ['browser', async () => createWebStorage(`lc-${Math.random()}`).catch(() => null)],
])('loadChanged (%s)', (_name, make) => {
  let s: NotesStorage | null;
  beforeEach(async () => {
    s = await make();
  });

  it('reads only pages that are new or whose rev moved, and lists every live id', async () => {
    if (!s) return; // no IndexedDB here: the real browser covers it
    for (const id of ['a', 'b', 'c']) await s.savePage(page(id));
    const all = (await s.loadAll()).pages;
    const known = Object.fromEntries(all.map((p) => [p.id, p.rev]));
    expect((await s.loadChanged(known, null)).pages).toEqual([]);

    const b = (await s.loadPage('b'))!;
    await s.savePage({ ...b, title: 'B2' });
    const r = await s.loadChanged(known, null);
    expect(r.pages.map((p) => p.id)).toEqual(['b']);
    expect(r.pages[0].title).toBe('B2');
    expect(r.ids.sort()).toEqual(['a', 'b', 'c']);

    expect((await s.loadChanged({ a: known.a }, null)).pages.map((p) => p.id).sort()).toEqual(['b', 'c']); // unknown ones come back in full
  });
});
