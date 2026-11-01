import { describe, expect, it } from 'vitest';
import { GraphRepo } from '../src/graph/repo';
import { openWasmDb } from '../src/graph/wasmDb';

// The browser dev server runs the graph on WebAssembly SQLite; check it behaves like the real thing.
describe('wasm SQLite backend (npm run dev)', () => {
  it('applies the schema and supports the repository, links and full-text search', async () => {
    // Node needs the package's Node entry point (the default one is for browsers).
    const entry = new URL('../node_modules/@sqlite.org/sqlite-wasm/dist/node.mjs', import.meta.url).href;
    const db = await openWasmDb(async () => (await import(/* @vite-ignore */ entry)).default());
    const repo = new GraphRepo(db, 'web');
    await repo.createNode({ id: 'a', type: 'page', title: 'A' });
    await repo.createNode({ id: 'b', type: 'page', title: 'B' });
    await repo.createBlock({ id: 'b1', pageId: 'a', type: 'text', plainText: 'wasm search works' });
    const e = await repo.link('a', 'b', 'LINKS_TO');
    expect((await repo.link('a', 'b', 'LINKS_TO')).id).toBe(e.id);
    expect((await repo.searchBlocks('wasm')).map((h) => h.blockId)).toEqual(['b1']);
    await repo.deleteBlock('b1');
    expect(await repo.searchBlocks('wasm')).toEqual([]);
    await expect(repo.transaction(async () => { await repo.link('b', 'a', 'RELATED'); throw new Error('x'); })).rejects.toThrow('x');
    expect(await repo.listEdges({ type: 'RELATED' })).toEqual([]);
  });
});
