/** One streamed answer from the chosen chat provider. Shared by the chat panel and the inline AI card. */
import { chatRequest, parseStreamLine } from '../../lib/llm/providers';
import { sendRequest } from '../../lib/llm/transport';
import { LlmError, type ChatMsg } from '../../lib/llm/types';
import type { AiSettings } from './config';

/**
 * Asks the model and returns its whole answer; `onText` hears the answer so far after each piece.
 * Stopping through `signal` returns what had arrived, without an error. Throws a message fit to show when the provider
 * reports an error (after any text already sent to `onText`), or answers with nothing.
 */
export async function streamChat(
  settings: AiSettings,
  system: string,
  messages: ChatMsg[],
  opts: { signal?: AbortSignal; onText?: (answerSoFar: string) => void } = {},
): Promise<string> {
  const spec = chatRequest(settings, system, messages);
  let answer = '';
  let failure = '';
  await sendRequest(spec, {
    signal: opts.signal,
    model: settings.models[settings.provider],
    onLine: (line) => {
      for (const ev of parseStreamLine(spec.provider, line)) {
        if (ev.type === 'text') {
          answer += ev.text;
          opts.onText?.(answer);
        } else if (ev.type === 'error') failure = ev.message;
      }
    },
  });
  if (failure) throw new LlmError(failure);
  if (!answer && !opts.signal?.aborted) throw new LlmError('The model sent back nothing.');
  return answer;
}
