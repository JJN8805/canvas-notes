/**
 * Conversations. They live in memory only and are never saved. The page drawer's conversation is forgotten when the drawer closes;
 * the Chat screen's lasts until "New chat" or until the app is closed. Each is its own store, made by `createChat`.
 */
import { create } from 'zustand';
import { generateImageB64 } from './picture';
import { streamChat } from './stream';
import { LlmError, type ChatMsg } from '../../lib/llm/types';
import { newId } from '../../lib/util';
import { SYSTEM_PROMPT } from './prompts';
import { EDIT_PROMPT, type AliasMap } from './edits';
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
  /** Titles of the pages attached to this message (the Chat screen can attach several). */
  sharedPages?: string[];
  streaming?: boolean;
  /** Set when the assistant was allowed to suggest changes to the page: the labels it was shown (b1, b2 …) and what each box held then. */
  aliases?: AliasMap;
  /** What became of the changes this answer proposed. Absent = still waiting for the user. */
  proposal?: { state: 'applied' | 'discarded'; note?: string };
}

interface ChatState {
  messages: Message[];
  busy: boolean;
  /** The provider the user has agreed to send this chat's page text to. Forgotten with the chat. */
  consented: string | null;
}

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

/** The conversation as the provider wants it: pictures become a short note, and failed answers are left out. */
export function wireHistory(messages: Message[]): ChatMsg[] {
  return messages
    .filter((m) => !m.error && !m.streaming && (m.content || m.imageB64 || m.wire))
    .map((m) => ({ role: m.role, content: m.imageB64 ? `[A picture was generated for: ${m.content}]` : m.wire ?? m.content }));
}

export type AskOptions = { wire?: string; shared?: Message['shared']; sharedPages?: string[]; consent?: boolean; aliases?: AliasMap };

/** One independent conversation: its own messages, its own "busy", its own way to stop. */
export function createChat() {
  const useStore = create<ChatState>(() => ({ messages: [], busy: false, consented: null }));
  let abort: AbortController | null = null;
  const patch = (id: string, p: Partial<Message>) => useStore.setState((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) }));

  function clear() {
    abort?.abort();
    abort = null;
    useStore.setState({ messages: [], busy: false, consented: null });
  }

  function stop() {
    abort?.abort();
  }

  /** Asks the chosen provider. `wire` is the text actually sent (the page attached); `text` is what is shown. */
  async function ask(settings: AiSettings, text: string, opts: AskOptions = {}) {
    if (useStore.getState().busy) return;
    const user: Message = { id: newId(), role: 'user', content: text, wire: opts.wire, shared: opts.shared, sharedPages: opts.sharedPages, aliases: opts.aliases };
    const reply: Message = { id: newId(), role: 'assistant', content: '', streaming: true, aliases: opts.aliases };
    useStore.setState((s) => ({ messages: [...s.messages, user, reply], busy: true, consented: opts.consent ? settings.provider : s.consented }));
    abort = new AbortController();
    const mine = abort;
    try {
      const history = wireHistory(useStore.getState().messages.filter((m) => m.id !== reply.id));
      await streamChat(settings, opts.aliases ? SYSTEM_PROMPT + '\n\n' + EDIT_PROMPT : SYSTEM_PROMPT, history, { signal: mine.signal, onText: (t) => patch(reply.id, { content: t }) });
      patch(reply.id, { streaming: false });
    } catch (e) {
      patch(reply.id, { streaming: false, error: e instanceof LlmError ? e.message : e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      if (abort === mine) abort = null;
      useStore.setState({ busy: false });
    }
  }

  /** Asks OpenAI (or a picture server) to draw a picture. */
  async function draw(settings: AiSettings, prompt: string) {
    if (useStore.getState().busy) return;
    const user: Message = { id: newId(), role: 'user', content: prompt };
    const reply: Message = { id: newId(), role: 'assistant', content: prompt, streaming: true };
    useStore.setState((s) => ({ messages: [...s.messages, user, reply], busy: true }));
    abort = new AbortController();
    const mine = abort;
    try {
      patch(reply.id, { streaming: false, imageB64: await generateImageB64(settings, prompt, mine.signal) });
    } catch (e) {
      patch(reply.id, { streaming: false, error: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      if (abort === mine) abort = null;
      useStore.setState({ busy: false });
    }
  }

  /** Asks the last question again, replacing the last answer. Does nothing while an answer is being written. */
  async function regenerate(settings: AiSettings) {
    const { messages, busy } = useStore.getState();
    if (busy) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const at = messages.findIndex((m) => m.id === lastUser.id);
    useStore.setState({ messages: messages.slice(0, at) }); // drop that question and everything after it, then ask it afresh
    await ask(settings, lastUser.content, { wire: lastUser.wire, shared: lastUser.shared, sharedPages: lastUser.sharedPages, aliases: lastUser.aliases });
  }

  /** Records what became of a proposal (applied or discarded). */
  const settle = (id: string, proposal: Message['proposal']) => patch(id, { proposal });

  return { useStore, ask, draw, regenerate, clear, stop, settle };
}

/** The page drawer's conversation (the exports below keep the names the drawer and the tests already use). */
export const panelChat = createChat();
export const useChat = panelChat.useStore;
export const askChat = panelChat.ask;
export const drawImage = panelChat.draw;
export const regenerateLast = panelChat.regenerate;
export const clearChat = panelChat.clear;
export const stopChat = panelChat.stop;
export const settleProposal = panelChat.settle;

/** The Chat screen's conversation: separate from the drawer's, and kept while you move around the app. */
export const mainChat = createChat();
