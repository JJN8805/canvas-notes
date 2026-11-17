/** The index in memory: every stored vector as a normalised array, ready to compare. Loaded from the database for one model at a time. */
import type { VectorKey, VectorRow, VectorStore } from '../../../storage/types';
import { passageKey } from '../notesSearch';
import { dequantize, quantize, topK } from './vectors';

export interface Entry extends VectorKey {
  key: string;
  hash: string;
  vec: Float32Array;
}

export class VectorIndex {
  model = '';
  private entries = new Map<string, Entry>();

  get size() {
    return this.entries.size;
  }
  get dim() {
    return this.entries.values().next().value?.vec.length ?? 0;
  }
  has(key: string) {
    return this.entries.has(key);
  }
  /** What is stored, in the form the plan needs. */
  keys(): { pageId: string; blockId: string; chunk: number; hash: string }[] {
    return [...this.entries.values()].map(({ pageId, blockId, chunk, hash }) => ({ pageId, blockId, chunk, hash }));
  }

  reset(model = '') {
    this.model = model;
    this.entries.clear();
  }

  /** Reads the stored vectors of `model` (rows that can't be read are dropped). */
  async load(store: VectorStore, model: string) {
    this.reset(model);
    for (const r of await store.load(model)) {
      const vec = dequantize(r);
      if (!vec) continue;
      const key = passageKey(r);
      this.entries.set(key, { key, pageId: r.pageId, blockId: r.blockId, chunk: r.chunk, hash: r.hash, vec });
    }
  }

  /** Remembers new vectors (and returns the rows to store). */
  put(model: string, items: { pageId: string; blockId: string; chunk: number; hash: string; vector: number[] }[]): VectorRow[] {
    const rows: VectorRow[] = [];
    for (const it of items) {
      const q = quantize(it.vector);
      const vec = dequantize(q);
      if (!vec) continue;
      const key = passageKey(it);
      this.entries.set(key, { key, pageId: it.pageId, blockId: it.blockId, chunk: it.chunk, hash: it.hash, vec });
      rows.push({ pageId: it.pageId, blockId: it.blockId, chunk: it.chunk, hash: it.hash, model, ...q });
    }
    return rows;
  }

  remove(keys: VectorKey[]) {
    for (const k of keys) this.entries.delete(passageKey(k));
  }

  /** The passages most like the question, as keys with their similarity. */
  search(query: Float32Array, k = 30, min = 0.25) {
    return topK(query, [...this.entries.values()], k, min);
  }

  entry(key: string): Entry | undefined {
    return this.entries.get(key);
  }
}

export const ragIndex = new VectorIndex();
