import type { Page } from '../types';

/** Pages the person starred, and the pages they touched last (pure). Both only decide what the sidebar lists; no page is changed. */
export const MAX_FAVORITES = 30;
export const RECENT_COUNT = 5;

const safe = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);

/** The stored list, repaired: only safe ids, no repeats, at most MAX_FAVORITES; anything unreadable is an empty list. */
export function parseFavorites(raw: string | null | undefined): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter(safe))].slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

/** Add the id (at the end) or take it out. */
export function toggleFavorite(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return [...ids, id].slice(-MAX_FAVORITES);
}

/** The starred pages that still exist, in the order they were starred. */
export function favoritePages(ids: string[], pages: Page[]): Page[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** The pages edited most recently, newest first, leaving out starred ones (they are listed above already). */
export function recentPages(pages: Page[], favorites: string[] = [], n = RECENT_COUNT): Page[] {
  return pages
    .filter((p) => !favorites.includes(p.id))
    .sort((a, b) => b.updated - a.updated)
    .slice(0, n);
}
