import { describe, expect, it, vi } from 'vitest';
import { dequantize, dot, isVector, normalize, quantize, topK } from '../src/addons/ai/rag/vectors';
import { indexPlan, passageHash, textHash } from '../src/addons/ai/rag/plan';
import { fuse } from '../src/addons/ai/rag/fuse';
import { DEFAULT_EMBED_CONFIG, embedModelId, embedRequest, parseEmbeddings, type EmbedConfig } from '../src/addons/ai/rag/embedApi';
import { VectorIndex } from '../src/addons/ai/rag/memory';
import { createIndexer } from '../src/addons/ai/rag/indexer';
import { retrieveNotes } from '../src/addons/ai/rag/retrieve';
import { cleanRag, ragReady } from '../src/addons/ai/rag/config';
import { passageKey, passagesOf, type Passage } from '../src/addons/ai/notesSearch';
import type { VectorRow, VectorStore } from '../src/storage/types';
import type { Page } from '../src/types';

/* ---- a toy "model": words of one idea map to one dimension, so meaning can match where words do not ---- */
const CONCEPTS = [['cost', 'costs', 'spending', 'budget', 'expensive', 'cut', 'savings'], ['meeting', 'call', 'standup', 'agenda'], ['garden', 'plants', 'soil', 'seeds', 'tomato']];
const toyVector = (text: string): number[] => {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const v = CONCEPTS.map((c) => words.filter((w) => c.includes(w)).length);
  return v; // a text about none of the ideas is the zero vector, which is like nothing
};
const toyEmbed = async (_cfg: EmbedConfig, texts: readonly string[]) => texts.map(toyVector);

const page = (id: string, title: string, texts: string[], o: Partial<Page> = {}): Page => ({
  id, title, groupId: null, tags: [], blocks: texts.map((t, i) => ({ id: `${id}b${i}`, type: 'note', style: 'text', x: 0, y: i * 50, w: 300, h: 40, z: 1, html: `<p>${t}</p>` })) as never, arrows: [], created: 1, updated: 1, rev: 1, ...o,
});

function memoryStore(): VectorStore & { rows: Map<string, VectorRow> } {
  const rows = new Map<string, VectorRow>();
  const id = (m: string, k: { pageId: string; blockId: string; chunk: number }) => `${m}|${passageKey(k)}`;
  return {
    rows,
    load: async (m) => [...rows.values()].filter((r) => r.model === m),
    put: async (rs) => void rs.forEach((r) => rows.set(id(r.model, r), r)),
    remove: async (m, ks) => void ks.forEach((k) => rows.delete(id(m, k))),
    clear: async (keep) => void [...rows.keys()].forEach((k) => (keep === undefined || !k.startsWith(keep + '|') ? rows.delete(k) : undefined)),
    count: async (m) => [...rows.values()].filter((r) => m === undefined || r.model === m).length,
  };
}

describe('vectors', () => {
  it('normalises, and treats nonsense numbers as zero', () => {
    const n = normalize([3, 4]);
    expect(Math.hypot(...n)).toBeCloseTo(1);
    expect([...normalize([NaN, Infinity, 2])].every(Number.isFinite)).toBe(true);
    expect([...normalize([0, 0])]).toEqual([0, 0]);
  });
  it('survives being stored as bytes with little loss', () => {
    const v = Array.from({ length: 64 }, (_, i) => Math.sin(i) * (i % 7));
    const back = dequantize(quantize(v))!;
    expect(dot(normalize(v), back)).toBeGreaterThan(0.999);
  });
  it('refuses damaged stored vectors', () => {
    const q = quantize([1, 2, 3, 4]);
    for (const bad of [{ ...q, dim: 3 }, { ...q, vec: '!!!' }, { ...q, scale: 0 }, { ...q, scale: NaN }, { ...q, dim: 0 }, { ...q, dim: 100000 }]) expect(dequantize(bad)).toBeNull();
  });
  it('finds the nearest, best first, ignoring weak matches', () => {
    const items = [{ key: 'a', vec: normalize([1, 0]) }, { key: 'b', vec: normalize([1, 1]) }, { key: 'c', vec: normalize([0, 1]) }];
    expect(topK(normalize([1, 0]), items, 5, 0.2).map((x) => x.key)).toEqual(['a', 'b']);
    expect(topK(normalize([1, 0]), items, 1).map((x) => x.key)).toEqual(['a']);
    expect(dot(normalize([1, 0]), normalize([1, 0, 0]))).toBe(0); // different lengths never match
  });
  it('knows a real vector from a hostile one', () => {
    expect(isVector([0.1, -2])).toBe(true);
    for (const bad of [[], 'x', [1, 'a'], [1, NaN], [Infinity], null, { length: 3 }, new Array(5000).fill(1)]) expect(isVector(bad)).toBe(false);
  });
});

describe('what to embed', () => {
  const passages = passagesOf([page('a', 'Budget', ['We agreed to cut costs.', 'Second note.']), page('b', 'Garden', ['Plant tomato seeds.'])]);
  it('notices changed text but not unchanged', () => {
    expect(textHash('x')).toBe(textHash('x'));
    expect(textHash('x')).not.toBe(textHash('y'));
    const stored = passages.map((p) => ({ pageId: p.pageId, blockId: p.blockId, chunk: p.chunk, hash: passageHash(p) }));
    expect(indexPlan(passages, stored)).toMatchObject({ embed: [], forget: [], fresh: 3 });
    stored[0].hash = 'old';
    expect(indexPlan(passages, stored).embed.map((p) => p.blockId)).toEqual(['ab0']);
  });
  it('forgets what is gone and embeds what is new', () => {
    const stored = [{ pageId: 'zz', blockId: 'gone', chunk: 0, hash: 'h' }];
    const plan = indexPlan(passages, stored);
    expect(plan.forget).toEqual(stored);
    expect(plan.embed).toHaveLength(3);
  });
  it('keeps the most recently edited when there are more than the limit', () => {
    const many = ['old', 'mid', 'new'].map((id, i) => ({ pageId: id, blockId: 'b', chunk: 0, title: id, text: 't', updated: i })) as Passage[];
    expect(indexPlan(many, [], 2).embed.map((p) => p.pageId)).toEqual(['new', 'mid']);
  });
});

describe('fusing two rankings', () => {
  it('puts what both like first, and keeps one ranking when the other is empty', () => {
    expect(fuse([{ order: [1, 2, 3] }, { order: [3, 1] }])).toEqual([1, 3, 2]);
    expect(fuse([{ order: [4, 5] }, { order: [] }])).toEqual([4, 5]);
    expect(fuse([{ order: [] }, { order: [] }])).toEqual([]);
  });
});

describe('asking providers for embeddings', () => {
  const cfg = (source: EmbedConfig['source']): EmbedConfig => ({ ...DEFAULT_EMBED_CONFIG, source });
  it('builds each request for its own server, with prefixes only where a model wants them', () => {
    const local = embedRequest(cfg('local'), ['a', 'b'], 'document');
    expect(local).toMatchObject({ provider: 'ollama', url: 'http://localhost:11434/api/embed' });
    expect(JSON.parse(local.body!)).toEqual({ model: 'nomic-embed-text', input: ['search_document: a', 'search_document: b'] });
    expect(JSON.parse(embedRequest(cfg('local'), ['q'], 'query').body!).input).toEqual(['search_query: q']);
    expect(embedRequest(cfg('local'), ['a'], 'document', true).url).toMatch(/\/api\/embeddings$/);
    expect(embedRequest(cfg('openai'), ['a'], 'document').url).toBe('https://api.openai.com/v1/embeddings');
    const g = embedRequest(cfg('gemini'), ['a'], 'query');
    expect(g.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents');
    expect(JSON.parse(g.body!).requests[0]).toMatchObject({ taskType: 'RETRIEVAL_QUERY', model: 'models/gemini-embedding-001' });
    expect(g.headers).not.toHaveProperty('x-goog-api-key'); // the key is added by the Rust side, never here
  });
  it('refuses a bad address, an empty model, too many texts and a Gemini model name that could change the path', () => {
    expect(() => embedRequest({ ...cfg('local'), ollamaUrl: 'file:///etc' }, ['a'], 'document')).toThrow(/address/);
    expect(() => embedRequest({ ...cfg('local'), models: { ...cfg('local').models, local: '' } }, ['a'], 'document')).toThrow(/model/);
    expect(() => embedRequest(cfg('local'), new Array(101).fill('a'), 'document')).toThrow(/Too many/);
    expect(() => embedRequest({ ...cfg('gemini'), models: { ...cfg('gemini').models, gemini: '../files/x' } }, ['a'], 'document')).toThrow(/isn’t valid/);
  });
  it('clips very long texts', () => {
    expect(JSON.parse(embedRequest(cfg('openai'), ['x'.repeat(9000)], 'document').body!).input[0]).toHaveLength(2000);
  });
  it('reads each answer, in order, and refuses anything wrong', () => {
    expect(parseEmbeddings(cfg('local'), JSON.stringify({ embeddings: [[1, 2], [3, 4]] }), 2)).toEqual([[1, 2], [3, 4]]);
    expect(parseEmbeddings(cfg('local'), JSON.stringify({ embedding: [1, 2] }), 1)).toEqual([[1, 2]]);
    expect(parseEmbeddings(cfg('openai'), JSON.stringify({ data: [{ index: 1, embedding: [3] }, { index: 0, embedding: [1] }] }), 2)).toEqual([[1], [3]]);
    expect(parseEmbeddings(cfg('gemini'), JSON.stringify({ embeddings: [{ values: [5, 6] }] }), 1)).toEqual([[5, 6]]);
    for (const [body, n] of [['not json', 1], ['{}', 1], [JSON.stringify({ embeddings: [[1]] }), 2], [JSON.stringify({ embeddings: [['a']] }), 1], [JSON.stringify({ embeddings: [[1], [1, 2]] }), 2], [JSON.stringify({ embeddings: [[NaN]] }).replace('null', '1e999'), 1]] as [string, number][])
      expect(() => parseEmbeddings(cfg('local'), body, n), body).toThrow();
  });
  it('identifies vectors by source and model', () => {
    expect(embedModelId(cfg('local'))).toBe('local:nomic-embed-text');
    expect(embedModelId(cfg('openai'))).toBe('openai:text-embedding-3-small');
  });
});

describe('the settings keep cloud embedding off until agreed', () => {
  it('defaults to this computer, with the cloud off', () => {
    const s = cleanRag(null);
    expect(s).toMatchObject({ semantic: true, cloudConsent: null, assistantNotes: false, inlineNotes: false });
    expect(s.embed.source).toBe('local');
    expect(ragReady(s)).toEqual({ ok: true, model: 'local:nomic-embed-text' });
  });
  it('a cloud source without the agreement is put back to local, whatever was stored', () => {
    expect(cleanRag({ embed: { source: 'openai' } }).embed.source).toBe('local');
    expect(cleanRag({ embed: { source: 'openai' }, cloudConsent: 'gemini' }).embed.source).toBe('local');
    expect(cleanRag({ embed: { source: 'openai' }, cloudConsent: 'openai' })).toMatchObject({ embed: { source: 'openai' }, cloudConsent: 'openai' });
    expect(cleanRag({ embed: { source: 'local' }, cloudConsent: 'openai' }).cloudConsent).toBeNull();
    expect(cleanRag({ cloudConsent: 'local' }).cloudConsent).toBeNull();
  });
  it('is not ready when switched off or without a model, and repairs damaged settings', () => {
    expect(ragReady(cleanRag({ semantic: false }))).toEqual({ ok: false, reason: 'off' });
    expect(ragReady({ ...cleanRag(null), embed: { ...cleanRag(null).embed, models: { ...cleanRag(null).embed.models, local: '' } } })).toEqual({ ok: false, reason: 'no-model' });
    expect(cleanRag('junk').embed.models.local).toBe('nomic-embed-text');
    expect(cleanRag({ embed: { models: { local: 7 } } }).embed.models.local).toBe('nomic-embed-text');
  });
});

describe('the indexer', () => {
  const setup = (pages: Page[], over: { embed?: typeof toyEmbed; ready?: () => ReturnType<typeof ragReady> } = {}) => {
    const store = memoryStore();
    const index = new VectorIndex();
    const status: Record<string, unknown>[] = [];
    let current = pages;
    const embed = vi.fn(over.embed ?? toyEmbed);
    const ix = createIndexer({
      passages: () => passagesOf(current), ready: over.ready ?? (() => ragReady(cleanRag(null))), embedConfig: () => DEFAULT_EMBED_CONFIG, store: () => store, index, embed: embed as never,
      report: (p) => status.push({ ...p }),
    });
    return { store, index, status, ix, embed, set: (p: Page[]) => (current = p) };
  };
  it('embeds every passage, stores it, and reports progress', async () => {
    const t = setup([page('a', 'Budget', ['We agreed to cut costs.']), page('g', 'Garden', ['Plant tomato seeds.'])]);
    await t.ix.run();
    expect(t.index.size).toBe(2);
    expect(await t.store.count('local:nomic-embed-text')).toBe(2);
    expect(t.status.at(-1)).toMatchObject({ state: 'idle', done: 2, total: 2 });
  });
  it('a second run embeds nothing, an edit embeds only the changed passage, a deleted page is forgotten', async () => {
    const t = setup([page('a', 'Budget', ['We agreed to cut costs.']), page('g', 'Garden', ['Plant tomato seeds.'])]);
    await t.ix.run();
    t.embed.mockClear();
    await t.ix.run();
    expect(t.embed).not.toHaveBeenCalled();
    t.set([page('a', 'Budget', ['We agreed to cut costs.', 'And a new meeting.']), page('g', 'Garden', ['Plant tomato seeds.'])]);
    await t.ix.run();
    expect(t.embed.mock.calls[0][1]).toHaveLength(1);
    t.set([page('g', 'Garden', ['Plant tomato seeds.'])]);
    await t.ix.run();
    expect(t.index.size).toBe(1);
    expect(await t.store.count()).toBe(1);
  });
  it('a new model replaces the old model\'s vectors instead of mixing with them', async () => {
    const t = setup([page('a', 'Budget', ['cost'])]);
    await t.ix.run();
    t.store.rows.set('openai:x|stale', { pageId: 's', blockId: 's', chunk: 0, hash: 'h', model: 'openai:x', ...quantize([1, 2]) });
    t.index.reset();
    await t.ix.run();
    expect([...t.store.rows.values()].every((r) => r.model === 'local:nomic-embed-text')).toBe(true);
  });
  it('stops with a message when the model fails, keeps what was done, and tries again later', async () => {
    let calls = 0;
    const flaky = async (c: EmbedConfig, texts: readonly string[]) => {
      if (++calls === 2) throw new Error('Ollama is not running');
      return toyEmbed(c, texts);
    };
    const many = page('m', 'Many', Array.from({ length: 40 }, (_, i) => `note ${i} about cost`));
    const t = setup([many], { embed: flaky });
    await t.ix.run();
    expect(t.status.at(-1)).toMatchObject({ state: 'error', error: 'Ollama is not running' });
    expect(t.index.size).toBe(16); // the first batch was kept
    await t.ix.run();
    expect(t.status.at(-1)).toMatchObject({ state: 'idle', done: 40, total: 40 });
  });
  it('does nothing, and says why, when switched off or without a model', async () => {
    const t = setup([page('a', 'x', ['y'])], { ready: () => ({ ok: false, reason: 'off' }) });
    await t.ix.run();
    expect(t.embed).not.toHaveBeenCalled();
    expect(t.status.at(-1)).toMatchObject({ state: 'off' });
  });
  it('rebuild clears everything first', async () => {
    const t = setup([page('a', 'Budget', ['cost'])]);
    await t.ix.run();
    t.embed.mockClear();
    await t.ix.rebuild();
    expect(t.embed).toHaveBeenCalledTimes(1);
  });
  it('refuses vectors of the wrong count', async () => {
    const t = setup([page('a', 'Budget', ['cost'])], { embed: async () => [] });
    await t.ix.run();
    expect(t.status.at(-1)).toMatchObject({ state: 'error' });
    expect(t.index.size).toBe(0);
  });
});

describe('searching by words and by meaning', () => {
  const pages = [
    page('b', 'Planning', ['We agreed to cut costs next quarter.', 'Lunch is at noon.']),
    page('m', 'Weekly sync', ['The standup agenda is short.']),
    page('g', 'Garden', ['Plant tomato seeds in rich soil.', 'The word spending appears here only as a word.']),
  ];
  const passages = passagesOf(pages);
  const build = async () => {
    const index = new VectorIndex();
    const store = memoryStore();
    await createIndexer({ passages: () => passages, ready: () => ragReady(cleanRag(null)), embedConfig: () => DEFAULT_EMBED_CONFIG, store: () => store, index, embed: toyEmbed as never, report: () => {} }).run();
    return index;
  };
  const deps = (index: VectorIndex, embed = toyEmbed) => ({ ready: () => ragReady(cleanRag(null)), embedConfig: () => DEFAULT_EMBED_CONFIG, embed: embed as never, index });

  it('finds a passage that shares no word with the question, by its meaning', async () => {
    const q = 'what did we decide about spending?';
    const words = (await retrieveNotes(q, passages, deps(new VectorIndex()))).passages.map((p) => p.text);
    expect(words.some((t) => t.includes('cut costs'))).toBe(false); // words alone miss it
    const r = await retrieveNotes(q, passages, deps(await build()));
    expect(r.mode).toBe('words+meaning');
    expect(r.passages.some((p) => p.text.includes('cut costs'))).toBe(true); // found by meaning although it shares no word with the question
  });
  it('ranks what both words and meaning like above what only one likes', async () => {
    const r = await retrieveNotes('cost and spending', passages, deps(await build()));
    expect(r.passages[0].text).toContain('cut costs');
  });
  it('falls back to words, with a note, when the model can’t be reached', async () => {
    const down = async () => {
      throw new Error('connection refused');
    };
    const r = await retrieveNotes('tomato soil', passages, deps(await build(), down as never));
    expect(r.mode).toBe('words');
    expect(r.note).toMatch(/connection refused/);
    expect(r.passages[0].text).toContain('tomato');
  });
  it('says the index is not ready when it is empty, and still answers from words', async () => {
    const r = await retrieveNotes('tomato', passages, deps(new VectorIndex()));
    expect(r.mode).toBe('words');
    expect(r.note).toMatch(/isn’t ready/);
    expect(r.passages.length).toBeGreaterThan(0);
  });
  it('ignores a vector made from older text', async () => {
    const index = await build();
    const edited = passagesOf([page('b', 'Planning', ['Completely different words now.']), pages[1], pages[2]]);
    const r = await retrieveNotes('what did we decide about spending?', edited, deps(index));
    expect(r.passages.some((p) => p.text.includes('Completely different'))).toBe(false);
  });
  it('is quiet for a question about nothing, and respects the limits', async () => {
    const index = await build();
    expect((await retrieveNotes('zzz qqq', passages, deps(index))).passages).toEqual([]);
    const r = await retrieveNotes('cost spending meeting garden', passages, deps(index), { top: 2 });
    expect(r.passages).toHaveLength(2);
  });
});
