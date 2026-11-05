/**
 * The three model providers: how to ask each one, and how to read what comes back.
 * Pure functions, so they are tested with recorded-style responses and no network.
 */
import { destinationOf, normalizeBaseUrl } from './url';
import { LlmError, type ChatMsg, type ImageSource, type ProviderId, type RequestSpec, type StreamEvent, type WireProvider } from './types';

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
  gemini: { id: 'gemini', label: 'Gemini (Google)', needsKey: true, cloud: true, suggestions: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'] },
};

export interface ImageSourceInfo {
  id: ImageSource;
  label: string;
  /** Pictures are drawn by a company's servers, with the user's key. */
  cloud: boolean;
  defaultUrl: string;
}

export const IMAGE_SOURCES: Record<ImageSource, ImageSourceInfo> = {
  openai: { id: 'openai', label: 'OpenAI (cloud)', cloud: true, defaultUrl: '' },
  gemini: { id: 'gemini', label: 'Google Gemini (cloud)', cloud: true, defaultUrl: '' },
  sdwebui: { id: 'sdwebui', label: 'Stable Diffusion WebUI server (AUTOMATIC1111, Forge, SD.Next)', cloud: false, defaultUrl: 'http://127.0.0.1:7860' },
  imageserver: { id: 'imageserver', label: 'OpenAI-compatible image server (LocalAI and others)', cloud: false, defaultUrl: 'http://localhost:8080' },
};

export const IMAGE_SIZES = [512, 768, 1024] as const;

export interface ProviderConfig {
  provider: ProviderId;
  ollamaUrl: string;
  models: Record<ProviderId, string>;
  /** OpenAI model used to draw pictures. */
  imageModel: string;
  /** Gemini (or Imagen) model used to draw pictures. */
  geminiImageModel: string;
  /** Who draws pictures. Independent of the chat provider. */
  imageSource: ImageSource;
  /** Addresses of the local picture servers. */
  imageUrls: Record<'sdwebui' | 'imageserver', string>;
  /** Optional model or checkpoint name for a local picture server; empty = whatever the server has loaded. */
  imageServerModel: string;
  /** Width and height, in pixels, asked of a local picture server. */
  imageSize: number;
  /** Sampling steps asked of a Stable Diffusion WebUI server. */
  imageSteps: number;
}

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_CONFIG: ProviderConfig = {
  provider: 'ollama',
  ollamaUrl: DEFAULT_OLLAMA_URL,
  models: { ollama: '', anthropic: 'claude-sonnet-5-5', openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash' },
  imageModel: 'gpt-image-1',
  geminiImageModel: 'gemini-2.5-flash-image',
  imageSource: 'openai',
  imageUrls: { sdwebui: IMAGE_SOURCES.sdwebui.defaultUrl, imageserver: IMAGE_SOURCES.imageserver.defaultUrl },
  imageServerModel: '',
  imageSize: 512,
  imageSteps: 20,
};

const JSON_HEADERS = { 'content-type': 'application/json' };

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** A Gemini model name as it goes into the address. Anything that could change the path is refused. */
function geminiModel(name: string): string {
  const m = name.trim().replace(/^models\//, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(m)) throw new LlmError('That Gemini model name isn’t valid. Use a name like gemini-2.5-flash.');
  return m;
}

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
    case 'gemini':
      return {
        provider: 'gemini', method: 'POST', url: `${GEMINI_BASE}/${geminiModel(model)}:streamGenerateContent?alt=sse`, headers: JSON_HEADERS, stream: true,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        }),
      };
  }
}

function imageBase(cfg: ProviderConfig, source: 'sdwebui' | 'imageserver'): string {
  const base = normalizeBaseUrl(cfg.imageUrls[source]);
  if (!base) throw new LlmError(`The picture server address isn’t valid. Use something like ${IMAGE_SOURCES[source].defaultUrl}.`);
  return base;
}

/** The request that asks the chosen picture source to draw `prompt`. */
export function imageRequest(cfg: ProviderConfig, prompt: string): RequestSpec {
  const size = (IMAGE_SIZES as readonly number[]).includes(cfg.imageSize) ? cfg.imageSize : DEFAULT_CONFIG.imageSize;
  const model = cfg.imageServerModel.trim();
  switch (cfg.imageSource) {
    case 'sdwebui':
      return {
        provider: 'sdwebui', method: 'POST', url: `${imageBase(cfg, 'sdwebui')}/sdapi/v1/txt2img`, headers: JSON_HEADERS, stream: false,
        body: JSON.stringify({
          prompt, width: size, height: size, steps: Math.min(150, Math.max(1, Math.round(cfg.imageSteps) || DEFAULT_CONFIG.imageSteps)),
          batch_size: 1, n_iter: 1, send_images: true, save_images: false,
          ...(model ? { override_settings: { sd_model_checkpoint: model } } : {}),
        }),
      };
    case 'imageserver':
      return {
        provider: 'imageserver', method: 'POST', url: `${imageBase(cfg, 'imageserver')}/v1/images/generations`, headers: JSON_HEADERS, stream: false,
        body: JSON.stringify({ ...(model ? { model } : {}), prompt, n: 1, size: `${size}x${size}`, response_format: 'b64_json' }),
      };
    case 'gemini': {
      const gm = geminiModel(cfg.geminiImageModel.trim() || DEFAULT_CONFIG.geminiImageModel);
      // Imagen models answer through :predict; Gemini image models through :generateContent.
      if (gm.startsWith('imagen')) {
        return {
          provider: 'gemini', method: 'POST', url: `${GEMINI_BASE}/${gm}:predict`, headers: JSON_HEADERS, stream: false,
          body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }),
        };
      }
      return {
        provider: 'gemini', method: 'POST', url: `${GEMINI_BASE}/${gm}:generateContent`, headers: JSON_HEADERS, stream: false,
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
      };
    }
    default: {
      const openai = cfg.imageModel.trim() || DEFAULT_CONFIG.imageModel;
      return {
        provider: 'openai', method: 'POST', url: 'https://api.openai.com/v1/images/generations', headers: JSON_HEADERS, stream: false,
        body: JSON.stringify({ model: openai, prompt, n: 1, size: '1024x1024', ...(openai.startsWith('dall-e') ? { response_format: 'b64_json' } : {}) }),
      };
    }
  }
}

/** Asks a local picture server which models it has. (Not offered for OpenAI.) */
export function imageModelsRequest(cfg: ProviderConfig): RequestSpec {
  if (cfg.imageSource === 'sdwebui') return { provider: 'sdwebui', method: 'GET', url: `${imageBase(cfg, 'sdwebui')}/sdapi/v1/sd-models`, headers: {}, stream: false };
  if (cfg.imageSource === 'imageserver') return { provider: 'imageserver', method: 'GET', url: `${imageBase(cfg, 'imageserver')}/v1/models`, headers: {}, stream: false };
  throw new LlmError('The cloud picture models are named in the Picture model box.');
}

export function parseImageModels(source: ImageSource, body: string): string[] {
  const j = tryJson(body) as unknown;
  const names: unknown[] =
    source === 'sdwebui' && Array.isArray(j)
      ? j.map((m: { model_name?: unknown; title?: unknown }) => m?.model_name ?? m?.title)
      : Array.isArray((j as { data?: unknown })?.data)
        ? ((j as { data: { id?: unknown }[] }).data).map((m) => m?.id)
        : [];
  return [...new Set(names.filter((n): n is string => typeof n === 'string' && !!n))].sort();
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

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean; inlineData?: { data?: string }; inline_data?: { data?: string } }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
  predictions?: { bytesBase64Encoded?: string }[];
}

/** One line of a streamed answer → what it means. Lines that carry nothing (comments, pings, other events) give no events. */
export function parseStreamLine(provider: WireProvider, rawLine: string): StreamEvent[] {
  const line = rawLine.trim();
  if (!line || provider === 'sdwebui' || provider === 'imageserver') return []; // picture servers answer in one piece, not as a stream
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
  if (provider === 'gemini') {
    const j = tryJson(data) as GeminiChunk | undefined;
    if (!j || typeof j !== 'object') return [];
    if (j.error) return [{ type: 'error', message: j.error.message ?? 'Google reported an error.' }];
    if (j.promptFeedback?.blockReason) return [{ type: 'error', message: `Gemini declined this request (${j.promptFeedback.blockReason.toLowerCase().replace(/_/g, ' ')}).` }];
    const cand = j.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => (typeof p.text === 'string' && !p.thought ? p.text : '')).join('');
    const out: StreamEvent[] = text ? [{ type: 'text', text }] : [];
    if (cand?.finishReason && /SAFETY|BLOCKLIST|PROHIBITED|SPII|RECITATION/.test(cand.finishReason)) out.push({ type: 'error', message: `Gemini stopped the answer (${cand.finishReason.toLowerCase().replace(/_/g, ' ')}).` });
    else if (cand?.finishReason) out.push({ type: 'done' });
    return out;
  }
  const j = tryJson(data) as { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } } | undefined;
  if (!j) return [];
  if (j.type === 'error') return [{ type: 'error', message: j.error?.message ?? 'The provider reported an error.' }];
  if (j.type === 'message_stop') return [{ type: 'done' }];
  if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) return [{ type: 'text', text: j.delta.text }];
  return [];
}

/** The words of an error body from any of the picture sources: OpenAI-style, FastAPI-style ({detail}) or plain. */
function errorText(j: unknown): string {
  const o = (j && typeof j === 'object' ? j : {}) as { error?: unknown; message?: unknown; detail?: unknown; errors?: unknown };
  const pick = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(pick).filter(Boolean).join('; ');
    if (v && typeof v === 'object') return pick((v as { message?: unknown; msg?: unknown }).message ?? (v as { msg?: unknown }).msg);
    return '';
  };
  return (pick(o.error) || pick(o.message) || pick(o.detail) || pick(o.errors)).slice(0, 300);
}

/** The picture in a picture source's answer, as base64 (a `data:` prefix is removed). Throws a readable message when there isn't one. */
export function parseImageResponse(body: string): string {
  const j = tryJson(body) as ({ data?: { b64_json?: string; url?: string }[]; images?: unknown[] } & GeminiChunk) | undefined;
  const err = errorText(j);
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/^data:[^,]*,/, '').replace(/\s+/g, '') : '');
  const parts = j?.candidates?.flatMap((c) => c.content?.parts ?? []) ?? [];
  const found =
    clean(j?.data?.[0]?.b64_json) ||
    clean(j?.images?.[0]) ||
    clean(j?.predictions?.[0]?.bytesBase64Encoded) || // Imagen
    clean(parts.map((p) => p.inlineData?.data ?? p.inline_data?.data).find(Boolean)); // Gemini image models
  if (found && /^[A-Za-z0-9+/]+={0,2}$/.test(found) && found.length >= 16) return found;
  if (err) throw new LlmError(err);
  if (j?.promptFeedback?.blockReason) throw new LlmError(`Gemini declined to draw this (${j.promptFeedback.blockReason.toLowerCase().replace(/_/g, ' ')}). Try describing it differently.`);
  // Gemini sometimes answers in words instead of a picture (it refused, or asked a question): show what it said.
  const said = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join(' ').trim();
  if (said) throw new LlmError(`Gemini didn’t draw a picture. It said: ${said.slice(0, 240)}`);
  if (j?.data?.[0]?.url) throw new LlmError('The picture came back as a web link, which this app doesn’t fetch. Use a model or server setting that returns the picture itself.');
  throw new LlmError('No picture came back.');
}

/** What went wrong, for the user, from an HTTP status and the error body. */
export function explainHttpError(provider: WireProvider, status: number, body: string, model = ''): string {
  const detail = errorText(tryJson(body));
  if (provider === 'sdwebui' || provider === 'imageserver') {
    const what = provider === 'sdwebui' ? 'The Stable Diffusion server' : 'The picture server';
    const extra = detail ? ` ${detail}` : '';
    if (status === 404) return provider === 'sdwebui' ? `${what} answered “not found”. Was it started with the --api option?` : `${what} answered “not found”. Does it offer an OpenAI-style /v1/images/generations?`;
    if (status === 401 || status === 403) return `${what} refused the request.${extra}`;
    if (status === 422) return `${what} didn’t accept the request.${extra}`;
    if (status >= 500) return `${what} had a problem (${status}); it may be out of memory.${extra}`;
    return `${what} answered with an error (${status}).${extra}`;
  }
  const label = PROVIDERS[provider].label;
  // Google answers a wrong key with 400 "API key not valid", not 401.
  if (provider === 'gemini' && status === 400 && /api key/i.test(detail)) return `${label} rejected the API key. Check it in Settings → Add-ons.`;
  if (status === 401 || status === 403) return provider === 'ollama' ? 'Ollama refused the request.' : `${label} rejected the API key. Check it in Settings → Add-ons.`;
  if (status === 404) return provider === 'ollama' ? `Ollama doesn’t have the model “${model}”. Pull it first (ollama pull ${model}) or pick another.` : `${label} doesn’t know the model “${model}”.`;
  if (status === 429) return `${label} says there have been too many requests, or the account is out of credit. ${detail}`.trim();
  if (status >= 500) return `${label} had a problem (${status}). Try again in a moment. ${detail}`.trim();
  return `${label} answered with an error (${status}). ${detail}`.trim();
}

export { destinationOf };
