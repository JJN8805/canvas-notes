/** The conversation. It lives in memory only: closing the panel (or leaving the page) forgets it. */
import { create } from 'zustand';
import { chatRequest, parseStreamLine } from '../../lib/llm/providers';
import { generateImageB64 } from './picture';
import { sendRequest } from '../../lib/llm/transport';
import { LlmError, type ChatMsg } from '../../lib/llm/types';
import { newId } from '../../lib/util';
import { SYSTEM_PROMPT } from './prompts';
import type { AiSettings } from './config';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  /** What is shown. */
  content: string;
  /** What the model is sent for this message (the page may be attached to it). Absent = `content`. */
  wire?: string;
  /** A generated picture, as base64 PNG. */
  imageB64?: string;
  error?: string;
  /** The page text sent with this message: how much. */
  shared?: { chars: number; blocks: number };
  streaming?: boolean;
}

interface ChatState {
  messages: Message[];
  busy: boolean;
  /** The provider the user has agreed to send this chat's page text to. Forgotten with the chat. */
  consented: string | null;
}

export const useChat = create<ChatState>(() => ({ messages: [], busy: false, consented: null }));

/**
 * Must the user be shown what is about to be sent, and click, first? Yes when page text would leave this computer:
 * the new message attaches the page, or an earlier message already carries page text and this provider hasn't been agreed to yet
 * (say the chat was local and the user switched to a cloud model: the whole conversation would go along).
 */
export function needsConfirmation(a: {
  destination: 'local' | 'network' | 'cloud';
  confirmShare: boolean;
  newMessageHasPage: boolean;
  historyHasPage: boolean;
  provider: string;
  consented: string | null;
}): boolean {
  if (a.destination === 'local' || !a.confirmShare) return false;
  if (a.newMessageHasPage) return true;
  return a.historyHasPage && a.consented !== a.provider;
}

export const hasPageText = (wire: string) => wire.startsWith('<page>');

let abort: AbortController | null = null;

const patch = (id: string, p: Partial<Message>) => useChat.setState((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) }));

/** The conversation as the provider wants it: pictures become a short note, and failed answers are left out. */
export function wireHistory(messages: Message[]): ChatMsg[] {
  return messages
    .filter((m) => !m.error && !m.streaming && (m.content || m.imageB64 || m.wire))
    .map((m) => ({ role: m.role, content: m.imageB64 ? `[A picture was generated for: ${m.content}]` : m.wire ?? m.content }));
}

export function clearChat() {
  abort?.abort();
  abort = null;
  useChat.setState({ messages: [], busy: false, consented: null });
}

export function stopChat() {
  abort?.abort();
}

/** Asks the chosen provider. `wire` is the text actually sent (the page attached); `text` is what is shown. */
export async function askChat(settings: AiSettings, text: string, opts: { wire?: string; shared?: Message['shared']; consent?: boolean } = {}) {
  if (useChat.getState().busy) return;
  const user: Message = { id: newId(), role: 'user', content: text, wire: opts.wire, shared: opts.shared };
  const reply: Message = { id: newId(), role: 'assistant', content: '', streaming: true };
  useChat.setState((s) => ({ messages: [...s.messages, user, reply], busy: true, consented: opts.consent ? settings.provider : s.consented }));
  abort = new AbortController();
  const mine = abort;
  try {
    const history = wireHistory(useChat.getState().messages.filter((m) => m.id !== reply.id));
    const spec = chatRequest(settings, SYSTEM_PROMPT, history);
    let answer = '';
    let failure = '';
    await sendRequest(spec, {
      signal: mine.signal,
      model: settings.models[settings.provider],
      onLine: (line) => {
        for (const ev of parseStreamLine(spec.provider, line)) {
          if (ev.type === 'text') {
            answer += ev.text;
            patch(reply.id, { content: answer });
          } else if (ev.type === 'error') failure = ev.message;
        }
      },
    });
    if (failure) patch(reply.id, { streaming: false, error: failure });
    else if (!answer && !mine.signal.aborted) patch(reply.id, { streaming: false, error: 'The model sent back nothing.' });
    else patch(reply.id, { streaming: false });
  } catch (e) {
    patch(reply.id, { streaming: false, error: e instanceof LlmError ? e.message : e instanceof Error ? e.message : 'Something went wrong.' });
  } finally {
    if (abort === mine) abort = null;
    useChat.setState({ busy: false });
  }
}

/** Asks OpenAI to draw a picture. */
export async function drawImage(settings: AiSettings, prompt: string) {
  if (useChat.getState().busy) return;
  const user: Message = { id: newId(), role: 'user', content: prompt };
  const reply: Message = { id: newId(), role: 'assistant', content: prompt, streaming: true };
  useChat.setState((s) => ({ messages: [...s.messages, user, reply], busy: true }));
  abort = new AbortController();
  const mine = abort;
  try {
    patch(reply.id, { streaming: false, imageB64: await generateImageB64(settings, prompt, mine.signal) });
  } catch (e) {
    patch(reply.id, { streaming: false, error: e instanceof Error ? e.message : 'Something went wrong.' });
  } finally {
    if (abort === mine) abort = null;
    useChat.setState({ busy: false });
  }
}
