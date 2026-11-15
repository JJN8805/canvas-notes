import { create } from 'zustand';
import { navigate } from '../../lib/route';
import { setFilter } from '../../store/notes';

/** A question waiting for the Chat screen to ask it (from "Search or ask"). The screen takes it as soon as it is on show. */
export const useChatInbox = create<{ question: string | null; /** Pages to attach to the question. */ pageIds: string[]; /** Open the screen with "search my notes" switched on. */ notes: boolean }>(() => ({ question: null, pageIds: [], notes: false }));

export function openChat() {
  setFilter({ kind: 'addon', id: 'ai' });
  navigate({ name: 'library' });
}

/** Opens the Chat screen and asks `question` there. */
export function askInChat(question: string, opts: { pageIds?: string[] } = {}) {
  useChatInbox.setState({ question, pageIds: opts.pageIds ?? [] });
  openChat();
}

/** Opens the Chat screen with "search my notes" switched on, ready for a question about the user's own pages. */
export function askMyNotes() {
  useChatInbox.setState({ question: null, pageIds: [], notes: true });
  openChat();
}
