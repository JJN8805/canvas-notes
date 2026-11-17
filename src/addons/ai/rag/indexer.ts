/**
 * Keeps the index up to date (dependencies are passed in, so it runs in tests with a fake model and a fake database): works out which
 * passages have no current vector, embeds them in batches, stores each batch as soon as it is made (so an interrupted run loses little),
 * and forgets vectors of text that is gone. It never changes a page.
 */
import { LlmError } from '../../../lib/llm/types';
import type { VectorStore } from '../../../storage/types';
import type { Passage } from '../notesSearch';
import type { Embedder } from './client';
import { EMBED_SOURCES, embedModelId, type EmbedConfig } from './embedApi';
import type { VectorIndex } from './memory';
import { embedText, indexPlan, passageHash } from './plan';
import type { Ready } from './config';
import type { RagStatus } from './status';

export interface IndexerDeps {
  passages: () => Passage[];
  ready: () => Ready;
  embedConfig: () => EmbedConfig;
  store: () => VectorStore;
  index: VectorIndex;
  embed: Embedder;
  report: (p: Partial<RagStatus>) => void;
  /** Whether to keep going (false when the add-on was switched off, say). */
  alive?: () => boolean;
}

export interface Indexer {
  /** Brings the index up to date. Starting it while it runs asks it to look again when it finishes. */
  run(): Promise<void>;
  /** Forgets every vector and builds again. */
  rebuild(): Promise<void>;
  stop(): void;
}

const chunked = <T,>(items: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
};

const messageOf = (e: unknown) => (e instanceof LlmError ? e.message : e instanceof Error ? e.message : 'Something went wrong while indexing.');

export function createIndexer(d: IndexerDeps): Indexer {
  let running = false;
  let again = false;
  let abort: AbortController | null = null;
  const alive = () => d.alive?.() ?? true;

  async function once(): Promise<boolean> {
    const ready = d.ready();
    if (!ready.ok) {
      d.index.reset();
      d.report({ state: 'off', done: 0, total: 0, error: '', model: '', note: ready.reason === 'no-model' ? 'Choose an embedding model to search by meaning.' : 'Searching by meaning is switched off.' });
      return false;
    }
    const cfg = d.embedConfig();
    const model = embedModelId(cfg);
    const store = d.store();
    if (d.index.model !== model) {
      await store.clear(model); // vectors of another model can't be compared with this one's: keep only this model's
      await d.index.load(store, model);
    }
    const passages = d.passages();
    const plan = indexPlan(passages, d.index.keys());
    if (plan.forget.length) {
      await store.remove(model, plan.forget);
      d.index.remove(plan.forget);
    }
    const total = plan.fresh + plan.embed.length;
    d.report({ state: plan.embed.length ? 'indexing' : 'idle', model, done: plan.fresh, total, error: '', note: '' });
    if (!plan.embed.length) return true;

    abort = new AbortController();
    const signal = abort.signal;
    let done = plan.fresh;
    const batch = EMBED_SOURCES[cfg.source].batch;
    for (const group of chunked(plan.embed, batch)) {
      if (signal.aborted || !alive()) return false;
      const vectors = await d.embed(cfg, group.map(embedText), 'document', signal);
      if (signal.aborted || !alive()) return false;
      if (vectors.length !== group.length) throw new LlmError('The embedding service returned the wrong number of vectors.');
      const dim = d.index.dim;
      if (dim && vectors[0].length !== dim) {
        // Same model name, different vector length: the model was replaced under us. Start this model's index afresh.
        await store.clear();
        d.index.reset(model);
        throw new LlmError('The embedding model now gives vectors of a different size. Press “Rebuild” to index again.');
      }
      const rows = d.index.put(model, group.map((p, i) => ({ pageId: p.pageId, blockId: p.blockId, chunk: p.chunk, hash: passageHash(p), vector: vectors[i] })));
      await store.put(rows);
      done += group.length;
      d.report({ state: done >= total ? 'idle' : 'indexing', done, total });
    }
    return true;
  }

  async function run() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        try {
          await once();
        } catch (e) {
          d.report({ state: 'error', error: messageOf(e) });
          again = false; // a failure is shown, not retried in a loop; the next change or the button tries again
        }
      } while (again && alive());
    } finally {
      running = false;
      abort = null;
    }
  }

  return {
    run,
    async rebuild() {
      abort?.abort();
      await d.store().clear();
      d.index.reset();
      await run();
    },
    stop() {
      abort?.abort();
    },
  };
}
