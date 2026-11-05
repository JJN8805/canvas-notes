/** Small pure helpers for generated pictures: what kind of file they are, and where the request that made them went. */
import { IMAGE_SOURCES, type ProviderConfig } from './providers';
import { destinationOf, normalizeBaseUrl } from './url';
import type { Destination } from './types';

/** The picture's file type from its first bytes. Local servers answer with PNG, JPEG or WebP depending on their settings, so it can't be assumed. */
export function imageTypeOf(b64: string): { mime: string; ext: string } {
  let bytes: number[] = [];
  try {
    bytes = Array.from(atob(b64.slice(0, 24)), (c) => c.charCodeAt(0));
  } catch {
    /* not base64: fall through to the default */
  }
  const is = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (is(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', ext: 'jpg' };
  if (is(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
  if (is(0x47, 0x49, 0x46, 0x38)) return { mime: 'image/gif', ext: 'gif' };
  return { mime: 'image/png', ext: 'png' };
}

/** Where a picture request goes: OpenAI (cloud), a server on this computer, or a server elsewhere on the network. */
export function imageDestination(cfg: Pick<ProviderConfig, 'imageSource' | 'imageUrls'>): Destination {
  if (cfg.imageSource === 'openai' || cfg.imageSource === 'gemini') return 'cloud';
  return destinationOf('ollama', cfg.imageUrls[cfg.imageSource]); // same rule as Ollama: loopback addresses are "this computer"
}

/** "OpenAI", or "the Stable Diffusion server at 127.0.0.1:7860 (on this computer)", for the sentence that says where the description is sent. */
export function imageTargetLabel(cfg: Pick<ProviderConfig, 'imageSource' | 'imageUrls' | 'imageModel' | 'geminiImageModel'>): string {
  if (cfg.imageSource === 'openai') return `OpenAI (${cfg.imageModel})`;
  if (cfg.imageSource === 'gemini') return `Google Gemini (${cfg.geminiImageModel})`;
  const base = normalizeBaseUrl(cfg.imageUrls[cfg.imageSource]);
  const host = base ? new URL(base).host : cfg.imageUrls[cfg.imageSource];
  const kind = cfg.imageSource === 'sdwebui' ? 'the Stable Diffusion server' : 'the picture server';
  return `${kind} at ${host} (${imageDestination(cfg) === 'local' ? 'on this computer' : 'on another computer'})`;
}

export { IMAGE_SOURCES };
