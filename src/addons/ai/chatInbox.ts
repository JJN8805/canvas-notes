import { create } from 'zustand';
import { navigate } from '../../lib/route';
import { setFilter } from '../../store/notes';

/** A question waiting for the Chat screen to ask it (from "Search or ask"). The screen takes it as soon as it is on show. */
export const useChatInbox = create<{ question: string | null }>(() => ({ question: null }));

export function openChat() {
  setFilter({ kind: 'addon', id: 'ai' });
  navigate({ name: 'library' });
}

/** Opens the Chat screen and asks `question` there. */
export function askInChat(question: string) {
  useChatInbox.setState({ question });
  openChat();
}
