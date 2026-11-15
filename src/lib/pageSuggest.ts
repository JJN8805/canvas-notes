/** Typing `[[` in a note offers the pages to link to. The pure parts: when it applies, what to offer, and what to write. */
import type { Page } from '../types';
import { fuzzyFilter } from './fuzzy';
import { libraryPages } from './pages';

/** The `[[query` just before the cursor, or null. `length` counts the `[[` too, so the whole thing can be replaced. */
export function wikiTrigger(textBefore: string): { query: string; length: number } | null {
  const m = textBefore.match(/\[\[([^\[\]\n]{0,60})$/);
  return m ? { query: m[1], length: m[0].length } : null;
}

/** Up to `limit` pages whose title matches, best first (newest first when nothing is typed yet). The page being written on is not offered. */
export function suggestPages(pages: Record<string, Page>, query: string, exceptId: string | null, limit = 6): Page[] {
  const list = libraryPages(pages)
    .filter((p) => p.id !== exceptId && p.title.trim() && !p.dailyDate)
    .sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id));
  return fuzzyFilter(list, query, (p) => p.title).slice(0, limit);
}

/** What is typed for a chosen page. Square brackets in the title would end the link early, so they are left out. */
export const linkText = (title: string): string => `[[${title.replace(/[\[\]\n]/g, '').trim()}]]`;
