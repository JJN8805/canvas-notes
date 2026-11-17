import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { cleanVectorRow, type NotesStorage, type VectorRow } from '../src/storage/types';
import { quantize } from '../src/addons/ai/rag/vectors';

const row = (o: Partial<VectorRow> = {}): VectorRow => ({ pageId: 'p', blockId: 'b', chunk: 0, hash: 'h', model: 'local:m', ...quantize([1, 2, 3, 4]), ...o });
let s: NotesStorage;

beforeEach(async () => {
  useDevice('v');
  s = await createTauriStorage();
});

describe('stored embeddings (desktop database)', () => {
  it('stores, replaces and reads back by model', async () => {
    await s.vectors.put([row(), row({ blockId: 'c' }), row({ model: 'openai:x' })]);
    expect((await s.vectors.load('local:m')).map((r) => r.blockId).sort()).toEqual(['b', 'c']);
    await s.vectors.put([row({ hash: 'changed' })]);
    const again = await s.vectors.load('local:m');
    expect(again).toHaveLength(2);
    expect(again.find((r) => r.blockId === 'b')!.hash).toBe('changed');
    expect(await s.vectors.count('local:m')).toBe(2);
    expect(await s.vectors.count()).toBe(3);
  });
  it('removes by key, and clears all or all but one model', async () => {
    await s.vectors.put([row(), row({ chunk: 1 }), row({ model: 'openai:x' })]);
    await s.vectors.remove('local:m', [{ pageId: 'p', blockId: 'b', chunk: 0 }]);
    expect((await s.vectors.load('local:m')).map((r) => r.chunk)).toEqual([1]);
    await s.vectors.clear('local:m');
    expect(await s.vectors.count('openai:x')).toBe(0);
    expect(await s.vectors.count('local:m')).toBe(1);
    await s.vectors.clear();
    expect(await s.vectors.count()).toBe(0);
  });
  it('does not store a damaged row', async () => {
    await s.vectors.put([row({ dim: 99999 }), row({ scale: NaN }), { ...row(), vec: 5 as never }, row({ blockId: 'ok' })]);
    expect((await s.vectors.load('local:m')).map((r) => r.blockId)).toEqual(['ok']);
  });
  it('is kept apart from pages: nothing about it is in what a sync would send', async () => {
    await s.vectors.put([row()]);
    expect(await s.sync.listMeta('page')).toEqual([]);
    expect(await s.sync.listMeta('group')).toEqual([]);
  });
});

describe('reading a vector row', () => {
  it('accepts a good one and refuses nonsense', () => {
    expect(cleanVectorRow(row())).toMatchObject({ pageId: 'p', dim: 4 });
    for (const bad of [null, 'x', { ...row(), chunk: -1 }, { ...row(), chunk: 1.5 }, { ...row(), dim: 0 }, { ...row(), scale: 0 }, { ...row(), pageId: 3 }]) expect(cleanVectorRow(bad)).toBeNull();
  });
});
