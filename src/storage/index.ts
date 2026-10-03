import type { NotesStorage } from './types';

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Desktop app → SQLite + files. Plain browser (npm run dev) → IndexedDB. */
export async function openStorage(): Promise<NotesStorage> {
  if (isTauri()) {
    const { createTauriStorage } = await import('./tauri');
    return createTauriStorage();
  }
  const { createWebStorage } = await import('./web');
  return createWebStorage();
}

export type { NotesStorage, SaveResult } from './types';
