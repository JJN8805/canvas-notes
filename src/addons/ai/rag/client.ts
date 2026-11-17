/** Sends embedding requests through the app's transport (the Rust side adds API keys and checks the destination). */
import { sendRequest } from '../../../lib/llm/transport';
import { LlmError } from '../../../lib/llm/types';
import { embedRequest, parseEmbeddings, type EmbedConfig } from './embedApi';

export type Embedder = (cfg: EmbedConfig, texts: readonly string[], kind: 'document' | 'query', signal?: AbortSignal) => Promise<number[][]>;

/** The vectors for some texts. Older Ollama versions have only the one-at-a-time endpoint, so a 404 on the batch one falls back to it. */
export const embedTexts: Embedder = async (cfg, texts, kind, signal) => {
  const model = cfg.models[cfg.source];
  try {
    const body = await sendRequest(embedRequest(cfg, texts, kind), { signal, model });
    return parseEmbeddings(cfg, body, texts.length);
  } catch (e) {
    if (!(e instanceof LlmError) || e.status !== 404 || cfg.source !== 'local') throw e;
    // 404 can mean "no such model" (then the old endpoint says so too) or "an Ollama that predates /api/embed".
    const out: number[][] = [];
    for (const t of texts) {
      if (signal?.aborted) return [];
      const body = await sendRequest(embedRequest(cfg, [t], kind, true), { signal, model });
      out.push(...parseEmbeddings(cfg, body, 1));
    }
    return out;
  }
};
