/** Drawing a picture with OpenAI's image model. Shared by the chat panel and the card picture dialog. */
import { imageRequest, parseImageResponse } from '../../lib/llm/providers';
import { sendRequest } from '../../lib/llm/transport';
import type { AiSettings } from './config';

/** The picture as base64 PNG. Throws a message fit to show. Stopping through `signal` throws "Stopped." */
export async function generateImageB64(settings: AiSettings, prompt: string, signal?: AbortSignal): Promise<string> {
  const body = await sendRequest(imageRequest(settings, prompt.trim()), { signal, model: settings.imageModel });
  if (signal?.aborted) throw new Error('Stopped.');
  return parseImageResponse(body);
}

export function b64ToFile(b64: string, name: string): File {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: 'image/png' });
}

/** What the card dialog starts with: the card's label as a subject. Empty when the card has none. */
export const defaultCardPrompt = (label: string): string => (label.trim() ? `A picture for a card titled “${label.trim().slice(0, 80)}”` : '');
