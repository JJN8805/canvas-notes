/**
 * The three model providers: how to ask each one, and how to read what comes back.
 * Pure functions, so they are tested with recorded-style responses and no network.
 */
import { destinationOf, normalizeBaseUrl } from './url';
import { LlmError, type ChatMsg, type ProviderId, type RequestSpec, type StreamEvent } from './types';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Needs an API key (kept by the app's Rust side, never by the page). */
  needsKey: boolean;
  cloud: boolean;
  /** Models worth suggesting in the settings; any name can be typed. */
  suggestions: string[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  ollama: { id: 'ollama', label: 'Ollama', needsKey: false, cloud: false, suggestions: [] },
  anthropic: { id: 'anthropic', label: 'Claude (Anthropic)', needsKey: true, cloud: true, suggestions: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'] },
  openai: { id: 'openai', label: 'ChatGPT (OpenAI)', needsKey: true, cloud: true, suggestions: ['gpt-4o-mini', 'gpt-4o'] },
};

export interface ProviderConfig {
  provider: ProviderId;
  ollamaUrl: string;
  models: Record<ProviderId, string>;
  /** OpenAI model used to draw pictures. */
  imageModel: string;
}

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_CONFIG: ProviderConfig = {
  provider: 'ollama',
  ollamaUrl: DEFAULT_OLLAMA_URL,
  models: { ollama: '', anthropic: 'claude-sonnet-5-5', openai: 'gpt-4o-mini' },
  imageModel: 'gpt-image-1',
};

const JSON_HEADERS = { 'content-type': 'application/json' };

function ollamaBase(cfg: Pick<ProviderConfig, 'ollamaUrl'>): string {
  const base = normalizeBaseUrl(cfg.ollamaUrl);
  if (!base) throw new LlmError('The Ollama address isn’t valid. Use something like http://localhost:11434.');
  return base;
}

function modelOf(cfg: ProviderConfig): string {
  const m = cfg.models[cfg.provider].trim();
  if (!m) throw new LlmError(cfg.provider === 'ollama' ? 'Choose an Ollama model in Settings → Add-ons.' : 'Enter a model name in Settings → Add-ons.');
  return m;
}

/** The request that asks `cfg.provider` to answer a conversation (streamed). */
export function chatRequest(cfg: ProviderConfig, system: string, messages: ChatMsg[]): RequestSpec {
  const model = modelOf(cfg);
  switch (cfg.provider) {
    case 'ollama':
      return {
        provider: 'ollama', method: 'POST', url: `${ollamaBase(cfg)}/api/chat`, headers: JSON_HEADERS, stream: true,
        body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
      };
    case 'anthropic':
      return {
        provider: 'anthropic', method: 'POST', url: 'https://api.anthropic.com/v1/messages', stream: true,
        headers: { ...JSON_HEADERS, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 4096, stream: true, system, messages }),
      };
    case 'openai':
      return {
        provider: 'openai', method: 'POST', url: 'https://api.openai.com/v1/chat/completions', headers: JSON_HEADERS, stream: true,
        body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
      };
  }
}

/** OpenAI's picture request (only OpenAI draws pictures here). */
export function imageRequest(cfg: ProviderConfig, prompt: string): RequestSpec {
  const model = cfg.imageModel.trim() || DEFAULT_CONFIG.imageModel;
  return {
    provider: 'openai', method: 'POST', url: 'https://api.openai.com/v1/images/generations', headers: JSON_HEADERS, stream: false,
    body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024', ...(model.startsWith('dall-e') ? { response_format: 'b64_json' } : {}) }),
  };
}

/** The list of models an Ollama server has. */
export function ollamaModelsRequest(cfg: Pick<ProviderConfig, 'ollamaUrl'>): RequestSpec {
  return { provider: 'ollama', method: 'GET', url: `${ollamaBase(cfg)}/api/tags`, headers: {}, stream: false };
}

export function parseOllamaModels(body: string): string[] {
  try {
    const j = JSON.parse(body) as { models?: { name?: unknown }[] };
    return (j.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string').sort();
  } catch {
    return [];
  }
}

const tryJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

/** One line of a streamed answer → what it means. Lines that carry nothing (comments, pings, other events) give no events. */
export function parseStreamLine(provider: ProviderId, rawLine: string): StreamEvent[] {
  const line = rawLine.trim();
  if (!line) return [];
  if (provider === 'ollama') {
    const j = tryJson(line) as { message?: { content?: string }; done?: boolean; error?: string } | undefined;
    if (!j || typeof j !== 'object') return [];
    if (typeof j.error === 'string') return [{ type: 'error', message: j.error }];
    const out: StreamEvent[] = [];
    if (j.message?.content) out.push({ type: 'text', text: j.message.content });
    if (j.done) out.push({ type: 'done' });
    return out;
  }
  // Server-sent events: only `data:` lines matter.
  if (!line.startsWith('data:')) return [];
  const data = line.slice(5).trim();
  if (provider === 'openai') {
    if (data === '[DONE]') return [{ type: 'done' }];
    const j = tryJson(data) as { choices?: { delta?: { content?: string | null } }[]; error?: { message?: string } } | undefined;
    if (!j) return [];
    if (j.error) return [{ type: 'error', message: j.error.message ?? 'The provider reported an error.' }];
    const text = j.choices?.[0]?.delta?.content;
    return text ? [{ type: 'text', text }] : [];
  }
  const j = tryJson(data) as { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } } | undefined;
  if (!j) return [];
  if (j.type === 'error') return [{ type: 'error', message: j.error?.message ?? 'The provider reported an error.' }];
  if (j.type === 'message_stop') return [{ type: 'done' }];
  if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) return [{ type: 'text', text: j.delta.text }];
  return [];
}

/** The picture in OpenAI's answer, as base64. Throws a readable message when there isn't one. */
export function parseImageResponse(body: string): string {
  const j = tryJson(body) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } } | undefined;
  if (j?.error?.message) throw new LlmError(j.error.message);
  const first = j?.data?.[0];
  if (first?.b64_json) return first.b64_json;
  if (first?.url) throw new LlmError('The picture came back as a web link, which this app doesn’t fetch. Use an image model that returns the picture itself (gpt-image-1).');
  throw new LlmError('No picture came back.');
}

/** What went wrong, for the user, from an HTTP status and the error body. */
export function explainHttpError(provider: ProviderId, status: number, body: string, model = ''): string {
  const j = tryJson(body) as { error?: { message?: string } | string; message?: string } | undefined;
  const detail = (typeof j?.error === 'string' ? j.error : j?.error?.message ?? j?.message ?? '').toString().slice(0, 300);
  const label = PROVIDERS[provider].label;
  if (status === 401 || status === 403) return provider === 'ollama' ? 'Ollama refused the request.' : `${label} rejected the API key. Check it in Settings → Add-ons.`;
  if (status === 404) return provider === 'ollama' ? `Ollama doesn’t have the model “${model}”. Pull it first (ollama pull ${model}) or pick another.` : `${label} doesn’t know the model “${model}”.`;
  if (status === 429) return `${label} says there have been too many requests, or the account is out of credit. ${detail}`.trim();
  if (status >= 500) return `${label} had a problem (${status}). Try again in a moment. ${detail}`.trim();
  return `${label} answered with an error (${status}). ${detail}`.trim();
}

export { destinationOf };
