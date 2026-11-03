/** Reading the text in a picture with an Ollama vision model. Pure parts are exported for tests; the rest talks to Ollama on this computer only. */
import type { ImageBlock } from '../../types';
import { normalizeBaseUrl, isLoopbackHost } from '../../lib/llm/url';
import { LlmError, type RequestSpec } from '../../lib/llm/types';

export const OCR_PROMPT =
  'Read all the text visible in this image. Output only that text, exactly as written and in reading order, ' +
  'with a line break where the lines break. Do not describe the image and do not add comments. ' +
  'If there is no readable text, output exactly: NO TEXT';

export const MAX_OCR_CHARS = 20000;
/** Largest picture (as stored) that is sent to the model. */
export const MAX_OCR_BYTES = 12 * 1024 * 1024;

export interface OcrSettings {
  url: string;
  model: string;
}
export const DEFAULT_OCR: OcrSettings = { url: 'http://localhost:11434', model: '' };

/** The address, if it is Ollama on this computer. Pictures never go anywhere else. */
export function localOllamaBase(url: string): string {
  const base = normalizeBaseUrl(url);
  if (!base) throw new LlmError('The Ollama address isn’t valid. Use something like http://localhost:11434.');
  if (!isLoopbackHost(new URL(base).hostname)) throw new LlmError('Text from pictures only uses Ollama on this computer, so pictures never leave it. Use localhost or 127.0.0.1.');
  return base;
}

/** Whether a picture can be read: not a heatmap the app drew, and a kind vision models accept. */
export function ocrProblem(b: ImageBlock, mime: string | undefined, bytes: number): string | null {
  if (b.heat) return 'This picture was drawn by the app, not a photo or scan.';
  if (!b.imageId) return 'This picture has no image yet.';
  if (!mime) return 'The picture file is missing on this device.';
  if (mime === 'image/svg+xml') return 'Vision models can’t read SVG pictures.';
  if (!/^image\/(png|jpeg|webp|gif|bmp|avif)$/.test(mime)) return 'This kind of picture can’t be read.';
  if (bytes > MAX_OCR_BYTES) return 'This picture is too large to read (over 12 MB).';
  return null;
}

export function ocrRequest(settings: OcrSettings, imageB64: string): RequestSpec {
  const model = settings.model.trim();
  if (!model) throw new LlmError('Choose a vision model in Settings → Add-ons → Text from pictures.');
  return {
    provider: 'ollama', method: 'POST', url: `${localOllamaBase(settings.url)}/api/chat`, headers: { 'content-type': 'application/json' }, stream: false,
    body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: OCR_PROMPT, images: [imageB64] }] }),
  };
}

/** The text in Ollama's answer ('' when the model found none). Throws when the answer is an error. */
export function parseOcrResponse(body: string): string {
  let j: { message?: { content?: string }; error?: string };
  try {
    j = JSON.parse(body);
  } catch {
    throw new LlmError('Ollama’s answer wasn’t understood.');
  }
  if (typeof j.error === 'string') throw new LlmError(j.error);
  let text = (j.message?.content ?? '').replace(/\r\n?/g, '\n').trim();
  // Models sometimes wrap the text in a code fence despite being told not to.
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();
  if (/^no text\.?$/i.test(text)) return '';
  return text.length > MAX_OCR_CHARS ? text.slice(0, MAX_OCR_CHARS) : text;
}
