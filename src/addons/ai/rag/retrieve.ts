/**
 * Finding the passages of the person's notes that bear on a question, by words and by meaning (dependencies are passed in).
 * Words: the existing BM25 ranking. Meaning: the question's embedding against the stored vectors. The two rankings are fused; if the
 * meaning side is unavailable (no model, Ollama not running, index empty) the answer is simply the word ranking, with a note saying so.
 */
import { passageKey, scorePassages, selectPassages, DEFAULT_MAX_CHARS, DEFAULT_TOP, type Passage } from '../notesSearch';
import type { EmbedConfig } from './embedApi';
import type { Embedder } from './client';
import { fuse } from './fuse';
import type { VectorIndex } from './memory';
import { passageHash } from './plan';
import type { Ready } from './config';
import { normalize } from './vectors';

export interface RetrieveDeps {
  ready: () => Ready;
  embedConfig: () => EmbedConfig;
  embed: Embedder;
  index: VectorIndex;
}

export interface Retrieved {
  passages: Passage[];
  /** How they were found. */
  mode: 'words' | 'words+meaning';
  /** Set when searching by meaning was wanted but could not be used. */
  note?: string;
}

const CANDIDATES = 30;

export async function retrieveNotes(
  question: string,
  passages: readonly Passage[],
  d: RetrieveDeps,
  opts: { top?: number; maxChars?: number; signal?: AbortSignal } = {},
): Promise<Retrieved> {
  const top = opts.top ?? DEFAULT_TOP;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const words = scorePassages(question, passages).slice(0, CANDIDATES).map((s) => s.i);
  const ready = d.ready();
  if (!ready.ok || !d.index.size || d.index.model !== ready.model) {
    const note = ready.ok && !d.index.size ? 'Searching by meaning isn’t ready yet (the notes are still being indexed), so this used words only.' : undefined;
    return { passages: selectPassages(words, passages, top, maxChars), mode: 'words', note };
  }
  let meaning: number[] = [];
  try {
    const [vec] = await d.embed(d.embedConfig(), [question], 'query', opts.signal);
    const byKey = new Map(passages.map((p, i) => [passageKey(p), i]));
    for (const hit of d.index.search(normalize(vec), CANDIDATES * 2)) {
      const i = byKey.get(hit.key);
      const e = d.index.entry(hit.key);
      if (i === undefined || !e || e.hash !== passageHash(passages[i])) continue; // text changed since it was indexed: not trusted until re-embedded
      meaning.push(i);
      if (meaning.length >= CANDIDATES) break;
    }
  } catch (e) {
    if (opts.signal?.aborted) return { passages: [], mode: 'words' };
    meaning = [];
    return { passages: selectPassages(words, passages, top, maxChars), mode: 'words', note: `Searching by meaning didn’t work (${e instanceof Error ? e.message : 'unknown error'}), so this used words only.` };
  }
  const order = fuse([{ order: words }, { order: meaning }]);
  return { passages: selectPassages(order, passages, top, maxChars), mode: 'words+meaning' };
}
