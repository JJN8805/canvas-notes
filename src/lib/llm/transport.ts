/**
 * Sends a RequestSpec. In the desktop and Android app the request goes through the app's Rust side (`ai.rs`), which
 * adds the API key, refuses any other destination and streams the answer back. In the browser preview (`npm run dev`)
 * there is no Rust side, so the page uses `fetch` directly and keeps keys in memory only, until the page is reloaded.
 */
import { isTauri } from '../../storage';
import { newId } from '../util';
import { explainHttpError } from './providers';
import { LlmError, type ProviderId, type RequestSpec } from './types';

/** Providers that need no API key: Ollama and the local picture servers. */
const KEYLESS = new Set<string>(['ollama', 'sdwebui', 'imageserver']);

type Chunk =
  | { kind: 'line'; text: string }
  | { kind: 'body'; text: string }
  | { kind: 'done' }
  | { kind: 'failed'; status: number | null; message: string; body: string };

export interface SendOptions {
  /** Called with each line of a streamed answer. */
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  /** The model asked for, used to word a "not found" error. */
  model?: string;
}

/** Sends the request. Resolves with the whole body for a non-streamed request, or '' once a stream has ended (or been stopped). */
export async function sendRequest(spec: RequestSpec, opts: SendOptions = {}): Promise<string> {
  return isTauri() ? viaRust(spec, opts) : viaFetch(spec, opts);
}

function failure(spec: RequestSpec, c: Extract<Chunk, { kind: 'failed' }>, model?: string): LlmError {
  return c.status === null ? new LlmError(c.message || 'The request failed.') : new LlmError(c.message || explainHttpError(spec.provider, c.status, c.body, model), c.status);
}

async function viaRust(spec: RequestSpec, { onLine, signal, model }: SendOptions): Promise<string> {
  const { invoke, Channel } = await import('@tauri-apps/api/core');
  const id = newId();
  const channel = new Channel<Chunk>();
  let body = '';
  let failed: LlmError | null = null;
  const finished = new Promise<void>((resolve) => {
    channel.onmessage = (c) => {
      if (c.kind === 'line') onLine?.(c.text);
      else if (c.kind === 'body') body = c.text;
      else if (c.kind === 'failed') {
        failed = failure(spec, c, model);
        resolve();
      } else resolve();
    };
  });
  const stop = () => void invoke('ai_cancel', { id }).catch(() => {});
  if (signal?.aborted) return '';
  signal?.addEventListener('abort', stop, { once: true });
  try {
    await invoke('ai_request', {
      req: { id, provider: spec.provider, method: spec.method, url: spec.url, headers: Object.entries(spec.headers), body: spec.body ?? null, stream: spec.stream },
      onChunk: channel,
    });
    await finished;
  } catch (e) {
    throw new LlmError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'The request failed.');
  } finally {
    signal?.removeEventListener('abort', stop);
  }
  if (failed) throw failed;
  return body;
}

async function viaFetch(spec: RequestSpec, { onLine, signal, model }: SendOptions): Promise<string> {
  const headers: Record<string, string> = { ...spec.headers };
  if (spec.provider === 'anthropic') {
    headers['x-api-key'] = browserKeys.get('anthropic') ?? '';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (spec.provider === 'openai') headers.authorization = `Bearer ${browserKeys.get('openai') ?? ''}`;
  else if (spec.provider === 'gemini') headers['x-goog-api-key'] = browserKeys.get('gemini') ?? '';
  const keyed = !KEYLESS.has(spec.provider);
  if (keyed && !browserKeys.get(spec.provider as ProviderId)) throw new LlmError('No API key is saved for this provider. Add it in Settings → Add-ons.');
  let res: Response;
  try {
    res = await fetch(spec.url, { method: spec.method, headers, body: spec.body, signal, redirect: 'error' });
  } catch (e) {
    if (signal?.aborted) return '';
    const host = (() => {
      try {
        return new URL(spec.url).host;
      } catch {
        return spec.url;
      }
    })();
    const hint =
      spec.provider === 'ollama' ? 'Is Ollama running, and does it allow this page’s address (OLLAMA_ORIGINS)?'
      : spec.provider === 'sdwebui' ? 'Is the server running, started with --api (and --cors-allow-origins for this page)?'
      : spec.provider === 'imageserver' ? 'Is the picture server running there, and does it allow this page’s address?'
      : '';
    throw new LlmError(`Couldn't reach ${host}. ${hint} ${e instanceof Error ? e.message : ''}`.replace(/\s+/g, ' ').trim());
  }
  if (!res.ok) throw new LlmError(explainHttpError(spec.provider, res.status, (await res.text().catch(() => '')).slice(0, 64 * 1024), model), res.status);
  if (!spec.stream) return res.text();
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const l of lines) onLine?.(l.replace(/\r$/, ''));
    }
    if (pending) onLine?.(pending.replace(/\r$/, ''));
  } catch (e) {
    if (!signal?.aborted) throw new LlmError(`The connection broke: ${e instanceof Error ? e.message : e}`);
  }
  return '';
}

/* ------------------------------ API keys ------------------------------ */

/** Browser preview only: keys live here and are gone when the page reloads. */
const browserKeys = new Map<ProviderId, string>();

export const keys = {
  async has(provider: ProviderId): Promise<boolean> {
    if (!isTauri()) return browserKeys.has(provider);
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<boolean>('ai_key_has', { provider });
  },
  async set(provider: ProviderId, key: string): Promise<void> {
    if (!isTauri()) {
      if (!key.trim()) throw new LlmError('The key is empty.');
      browserKeys.set(provider, key.trim());
      return;
    }
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('ai_key_set', { provider, key });
    } catch (e) {
      throw new LlmError(typeof e === 'string' ? e : 'The key couldn’t be saved.');
    }
  },
  async clear(provider: ProviderId): Promise<void> {
    if (!isTauri()) {
      browserKeys.delete(provider);
      return;
    }
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('ai_key_clear', { provider });
  },
};
