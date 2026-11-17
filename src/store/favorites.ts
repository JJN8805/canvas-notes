import { create } from 'zustand';
import { parseFavorites, toggleFavorite } from '../lib/favorites';

const KEY = 'ui.favorites';

function read(): string[] {
  try {
    return parseFavorites(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

/** Starred pages. A per-device convenience (like which panels are open), so it lives in the browser's storage, not in the library or sync. */
export const useFavorites = create<{ ids: string[] }>(() => ({ ids: read() }));

export function toggleStar(id: string) {
  const ids = toggleFavorite(useFavorites.getState().ids, id);
  useFavorites.setState({ ids });
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* remembering stars is a convenience */
  }
}
