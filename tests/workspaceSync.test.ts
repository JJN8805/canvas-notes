import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import type { NotesStorage } from '../src/storage/types';
import type { Group, Page } from '../src/types';
import { handleRequest, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import { splitGroups, workspaceOf } from '../src/lib/workspaces';

function onDevice(name: string, s: NotesStorage): NotesStorage {
  const wrap = <T extends object>(obj: T): T =>
    new Proxy(obj, {
      get(target, prop) {
        const v = (target as Record<string | symbol, unknown>)[prop];
        if (prop === 'sync') return wrap(v as object);
        if (typeof v !== 'function') return v;
        return async (...args: unknown[]) => {
          useDevice(name);
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  return wrap(s);
}
let laptop: NotesStorage;
let phone: NotesStorage;
async function device(name: string) {
  useDevice(name);
  return onDevice(name, await createTauriStorage());
}
const send = <T,>(req: SyncRequest): Promise<T> => handleRequest(laptop.sync, JSON.parse(JSON.stringify(req))).then((r) => JSON.parse(JSON.stringify(r)) as T);
const sync = () => syncWithLaptop(phone.sync, send);
const page = (id: string, extra: Partial<Page> = {}): Page => ({ id, title: id, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra });
const ws = (id: string, name: string): Group => ({ id, name, color: 'teal', parentId: null, scope: 'workspaces' });
async function edit(s: NotesStorage, id: string, patch: Partial<Page>) {
  const cur = (await s.loadPage(id))!;
  const res = await s.savePage({ ...cur, ...patch });
  if (!res.ok) throw new Error('unexpected conflict');
}

beforeEach(async () => {
  laptop = await device('laptop');
  phone = await device('phone');
  await laptop.saveGroups([ws('w1', 'Student'), ws('w2', 'Creator')]);
  await laptop.savePage(page('p', { title: 'Shared page' }));
  await sync();
});

describe('workspaces and sync', () => {
  it('carries the workspaces and the pages in them to the other device', async () => {
    await edit(laptop, 'p', { workspace: 'w1' });
    await sync();
    const g = splitGroups((await phone.loadAll()).groups, null);
    expect(g.workspaces.map((w) => w.name).sort()).toEqual(['Creator', 'Student']);
    expect((await phone.loadPage('p'))!.workspace).toBe('w1');
  });

  it('keeps both when two devices move the same page to different workspaces', async () => {
    await edit(laptop, 'p', { workspace: 'w1' });
    await edit(phone, 'p', { workspace: 'w2' });
    await sync();
    for (const s of [laptop, phone]) {
      const all = (await s.loadAll()).pages.filter((p) => p.title.startsWith('Shared page'));
      expect(all).toHaveLength(2); // the page and its conflicted copy: nothing is lost
      expect(all.map((p) => workspaceOf(p)).sort()).toEqual(['w1', 'w2']);
    }
  });

  it('shows in Main a page edited in a workspace that was deleted on the other device', async () => {
    await edit(laptop, 'p', { workspace: 'w1' });
    await sync();
    // the laptop deletes the workspace (its page goes to Main) while the phone edits the page in it
    await edit(laptop, 'p', { workspace: undefined });
    await laptop.saveGroups([ws('w2', 'Creator')]);
    await edit(phone, 'p', { title: 'Edited on the phone' });
    await sync();
    for (const s of [laptop, phone]) {
      const rows = splitGroups((await s.loadAll()).groups, null).workspaces;
      expect(rows.map((w) => w.id)).toEqual(['w2']);
      const main = await s.loadChanged({}, '');
      const mine = main.pages.filter((p) => p.title.includes('Shared page') || p.title.includes('Edited on the phone'));
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((p) => workspaceOf(p) === '')).toBe(true); // none is stuck in the workspace that is gone
      expect((await s.outline()).filter((o) => o.workspace === 'w1')).toEqual([]);
    }
  });
});
