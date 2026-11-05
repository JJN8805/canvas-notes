import { create } from 'zustand';
import { dateKey } from '../lib/daily';
import { navigate } from '../lib/route';
import { setFilter } from './notes';
import { turnDirection } from '../lib/journal';

interface JournalState {
  /** The day the book is open at (YYYY-MM-DD). */
  date: string;
  /** Which way the last page turn went (1 = forward in time), and how many turns there have been: together they replay the page-turn animation. */
  dir: 1 | -1;
  turns: number;
  /** The table of contents is open. */
  contents: boolean;
  /** A day whose page was deleted: today's page is not made again for it until you start it (for this session). */
  skipAuto: string | null;
}

export const useJournal = create<JournalState>(() => ({ date: dateKey(), dir: 1, turns: 0, contents: false, skipAuto: null }));

/** Turns to a day. */
export function turnTo(date: string) {
  const cur = useJournal.getState();
  if (date === cur.date) return;
  useJournal.setState({ date, dir: turnDirection(cur.date, date), turns: cur.turns + 1, contents: false });
}

/** Opens the Journal (from anywhere) at a day, today by default. */
export function openJournal(date: string = dateKey()) {
  setFilter({ kind: 'journal' });
  navigate({ name: 'library' });
  const cur = useJournal.getState();
  if (cur.date !== date) useJournal.setState({ date, dir: turnDirection(cur.date, date), turns: cur.turns + 1, contents: false });
}

export const setContents = (contents: boolean) => useJournal.setState({ contents });

export const dontRemake = (date: string | null) => useJournal.setState({ skipAuto: date });
