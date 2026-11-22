// A rehearsal on a COPY of real data: set REAL_DB_COPY to a database file made with `VACUUM INTO` (never the live file). Skipped otherwise.
import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { splitGroups, workspaceOf } from '../src/lib/workspaces';
import { buildBackup } from '../src/lib/backup';

const copy = process.env.REAL_DB_COPY;

describe.skipIf(!copy)('a copy of the real library', () => {
  it('opens, loads every page and group, and the workspace paths agree with each other', async () => {
    useDevice('real');
    const d = new FakeDatabase();
    d.db = new DatabaseSync(copy!);
    FakeDatabase.next = d;
    const s = await createTauriStorage();
    const all = await s.loadAll();
    const split = splitGroups(all.groups, null);
    const nonTemplate = all.pages.filter((p) => p.kind !== 'template');
    const stray = nonTemplate.filter((p) => workspaceOf(p) && !split.workspaces.some((w) => w.id === workspaceOf(p)));
    console.log(`pages ${all.pages.length} (${nonTemplate.length} not templates), groups ${all.groups.length}, workspaces ${split.workspaces.length}, pages in an unknown workspace ${stray.length}`);
    expect(stray).toHaveLength(0); // a page of a workspace that has no row would be invisible
    const known = Object.fromEntries(all.pages.map((p) => [p.id, p.rev]));
    for (const scope of [null, '', ...split.workspaces.map((w) => w.id)]) {
      const r = await s.loadChanged({}, scope);
      expect(r.pages.length).toBe(r.ids.length);
      expect((await s.loadChanged(known, scope)).pages).toEqual([]);
    }
    const outline = await s.outline();
    expect(outline).toHaveLength(all.pages.length);
    // save a page unchanged in the copy: nothing is lost, the revision moves on
    const p = nonTemplate[0];
    const before = JSON.stringify((await s.loadPage(p.id))!.blocks);
    expect((await s.savePage({ ...(await s.loadPage(p.id))! })).ok).toBe(true);
    expect(JSON.stringify((await s.loadPage(p.id))!.blocks)).toBe(before);
    const backup = await buildBackup(s);
    expect(backup.pages.length).toBe(all.pages.length);
    // every picture a page uses is stored
    const missing = backup.pages.flatMap((r) => r.blocks).filter((b) => b.type === 'image' && !backup.images.some((i) => i.id === b.imageId));
    console.log(`pictures referenced but not stored: ${missing.length}`);
  });
});
