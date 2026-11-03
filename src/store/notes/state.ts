import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { Filter, Group, Page, SortKey } from '../../types';
import { type NotesStorage } from '../../storage';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface NotesState {
  status: 'loading' | 'ready' | 'failed';
  error: string | null;
  storageKind: 'desktop' | 'browser';
  storageLocation: string;
  pages: Record<string, Page>;
  /** Deleted pages that can still be restored (`updated` is when they were deleted). */
  trash: Page[];
  groups: Group[];
  save: { state: SaveState; message: string };
  filter: Filter;
  query: string;
  sort: SortKey;
  /** Bumped whenever undo/redo availability may have changed. */
  historyVersion: number;
  /** Groups whose subgroups are folded away in the sidebar. */
  collapsed: string[];
}

export const useNotes = create<NotesState>()(
  immer(() => ({
    status: 'loading' as const,
    error: null,
    storageKind: 'browser' as const,
    storageLocation: '',
    pages: {},
    trash: [],
    groups: [],
    save: { state: 'idle' as SaveState, message: '' },
    filter: { kind: 'all' } as Filter,
    query: '',
    sort: 'updated' as SortKey,
    historyVersion: 0,
    collapsed: [],
  })),
);

export const set = useNotes.setState;
export const get = useNotes.getState;

let storage: NotesStorage | null = null;
export function getStorage(): NotesStorage {
  if (!storage) throw new Error('Storage is not ready yet');
  return storage;
}
export function setStorage(s: NotesStorage) {
  storage = s;
}


/** The storage if it is open yet, without throwing. */
export const peekStorage = (): NotesStorage | null => storage;
