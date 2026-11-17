/**
 * Asking a provider for embeddings (pure: builds the request and reads the answer; whoever sends it adds the API key). Three
 * sources: Ollama on this computer (or elsewhere on the network), OpenAI and Google Gemini. Everything read back is checked: the right
 * number of vectors, each a plain finite list of numbers, all the same length.
 */
import { normalizeBaseUrl } from '../../../lib/llm/url';
import { LlmError, type RequestSpec } from '../../../lib/llm/types';
import { MAX_DIM, isVector } from './vectors';

export type EmbedSource = 'local' | 'openai' | 'gemini';

export interface EmbedConfig {
  source: EmbedSource;
  ollamaUrl: string;
  models: Record<EmbedSource, string>;
}

export const EMBED_SOURCES: Record<EmbedSource, { label: string; defaultModel: string; cloud: boolean; batch: number }> = {
  local: { label: 'This computer (Ollama)', defaultModel: 'nomic-embed-text', cloud: false, batch: 16 },
  openai: { label: 'OpenAI', defaultModel: 'text-embedding-3-small', cloud: true, batch: 64 },
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-embedding-001', cloud: true, batch: 50 },
};

const JSON_HEADERS = { 'content-type': 'application/json' };
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const MAX_TEXTS = 100;
export const MAX_TEXT_CHARS = 2000;

export const isCloudEmbedding = (s: EmbedSource) => EMBED_SOURCES[s].cloud;

/** What identifies the vectors: vectors from different models cannot be compared. */
export const embedModelId = (cfg: EmbedConfig): string => `${cfg.source}:${cfg.models[cfg.source].trim()}`;

/** Some embedding models are trained to be told whether the text is a stored passage or a question. */
const prefix = (model: string, kind: 'document' | 'query') => (/nomic/i.test(model) ? (kind === 'query' ? 'search_query: ' : 'search_document: ') : '');

function geminiModel(name: string): string {
  const m = name.trim().replace(/^models\//, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(m)) throw new LlmError('That Gemini model name isn’t valid. Use a name like gemini-embedding-001.');
  return m;
}

export function embedRequest(cfg: EmbedConfig, texts: readonly string[], kind: 'document' | 'query', legacy = false): RequestSpec {
  const model = cfg.models[cfg.source].trim();
  if (!model) throw new LlmError(cfg.source === 'local' ? 'Choose an embedding model in Settings → Add-ons.' : 'Enter an embedding model name in Settings → Add-ons.');
  if (!texts.length || texts.length > MAX_TEXTS) throw new LlmError('Too many passages in one request.');
  const clipped = texts.map((t) => t.slice(0, MAX_TEXT_CHARS));
  switch (cfg.source) {
    case 'local': {
      const base = normalizeBaseUrl(cfg.ollamaUrl);
      if (!base) throw new LlmError('The Ollama address isn’t valid. Use something like http://localhost:11434.');
      const pre = prefix(model, kind);
      if (legacy) return { provider: 'ollama', method: 'POST', url: `${base}/api/embeddings`, headers: JSON_HEADERS, stream: false, body: JSON.stringify({ model, prompt: pre + clipped[0] }) };
      return { provider: 'ollama', method: 'POST', url: `${base}/api/embed`, headers: JSON_HEADERS, stream: false, body: JSON.stringify({ model, input: clipped.map((t) => pre + t) }) };
    }
    case 'openai':
      return { provider: 'openai', method: 'POST', url: 'https://api.openai.com/v1/embeddings', headers: JSON_HEADERS, stream: false, body: JSON.stringify({ model, input: clipped, encoding_format: 'float' }) };
    case 'gemini': {
      const m = geminiModel(model);
      return {
        provider: 'gemini', method: 'POST', url: `${GEMINI_BASE}/${m}:batchEmbedContents`, headers: JSON_HEADERS, stream: false,
        body: JSON.stringify({ requests: clipped.map((t) => ({ model: `models/${m}`, content: { parts: [{ text: t }] }, taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' })) }),
      };
    }
  }
}

/** The vectors in an answer, in the order of the texts sent. Throws when anything is missing, damaged or the wrong size. */
export function parseEmbeddings(cfg: EmbedConfig, body: string, expected: number): number[][] {
  let j: unknown;
  try {
    j = JSON.parse(body);
  } catch {
    throw new LlmError('The embedding service sent something that isn’t JSON.');
  }
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  let raw: unknown[] = [];
  if (cfg.source === 'local') raw = Array.isArray(o.embeddings) ? o.embeddings : Array.isArray(o.embedding) ? [o.embedding] : [];
  else if (cfg.source === 'openai') {
    const data = Array.isArray(o.data) ? (o.data as { index?: unknown; embedding?: unknown }[]) : [];
    raw = [...data].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0)).map((d) => d.embedding);
  } else raw = Array.isArray(o.embeddings) ? (o.embeddings as { values?: unknown }[]).map((e) => e?.values) : [];
  if (raw.length !== expected) throw new LlmError(`The embedding service returned ${raw.length} vectors for ${expected} passages.`);
  const out: number[][] = [];
  for (const v of raw) {
    if (!isVector(v)) throw new LlmError('The embedding service sent a vector that isn’t a list of numbers.');
    if (out.length && v.length !== out[0].length) throw new LlmError('The embedding service sent vectors of different lengths.');
    out.push(v);
  }
  if (out[0] && out[0].length > MAX_DIM) throw new LlmError('The embedding vectors are too long.');
  return out;
}

/** The request that lists the Ollama models (the ones that can embed are picked by the person). */
export const DEFAULT_EMBED_CONFIG: EmbedConfig = { source: 'local', ollamaUrl: 'http://localhost:11434', models: { local: EMBED_SOURCES.local.defaultModel, openai: EMBED_SOURCES.openai.defaultModel, gemini: EMBED_SOURCES.gemini.defaultModel } };
