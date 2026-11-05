/** Drawing a picture with the chosen picture source (OpenAI, or a Stable Diffusion / OpenAI-compatible server). Shared by the chat panel and the card picture dialog. */
import { imageRequest, parseImageResponse } from '../../lib/llm/providers';
import { imageTypeOf } from '../../lib/llm/image';
import { sendRequest } from '../../lib/llm/transport';
import type { AiSettings } from './config';

/** The picture as base64 (PNG, JPEG or WebP, as the source made it). Throws a message fit to show. Stopping through `signal` throws "Stopped." */
export async function generateImageB64(settings: AiSettings, prompt: string, signal?: AbortSignal): Promise<string> {
  const model = settings.imageSource === 'openai' ? settings.imageModel : settings.imageSource === 'gemini' ? settings.geminiImageModel : settings.imageServerModel;
  const body = await sendRequest(imageRequest(settings, prompt.trim()), { signal, model });
  if (signal?.aborted) throw new Error('Stopped.');
  return parseImageResponse(body);
}

/** The picture as a file, named and typed by what it really is. */
export function b64ToFile(b64: string, name: string): File {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const { mime, ext } = imageTypeOf(b64);
  return new File([bytes], `${name.replace(/\.[^.]+$/, '')}.${ext}`, { type: mime });
}

/** For an <img src>. */
export const imageDataUrl = (b64: string): string => `data:${imageTypeOf(b64).mime};base64,${b64}`;

/** What the card dialog starts with: the card's label as a subject. Empty when the card has none. */
export const defaultCardPrompt = (label: string): string => (label.trim() ? `A picture for a card titled “${label.trim().slice(0, 80)}”` : '');
