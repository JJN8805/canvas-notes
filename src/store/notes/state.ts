import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { Filter, Group, Page, SortKey } from '../../types';
import type { PageStub } from '../../lib/workspaces';
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
  /** The folders and sections of the Cards screen (a tree of its own, kept apart from `groups`). */
  cardFolders: Group[];
  /**
   * Workspaces (see lib/workspaces.ts). `pages`, `groups`, `cardFolders` and `trash` above hold only the OPEN workspace, so every screen
   * is scoped without knowing about it. `null` = no scoping (a widget window, which can pin a box from any workspace).
   */
  workspace: string | null;
  /** The workspaces that have been made (Main is not a row). */
  workspaces: Group[];
  /** What Main is called on this device. */
  mainName: string;
  /** Page groups and card folders of the workspaces that are not open: kept so saving the groups never drops them. */
  hiddenGroups: Group[];
  hiddenCardFolders: Group[];
  /** The pages of the other workspaces, as short lines (for linking to them and for counts). */
  elsewhere: PageStub[];
  save: { state: SaveState; message: string };
  filter: Filter;
  query: string;
  sort: SortKey;
  /** Bumped whenever undo/redo availability may have changed. */
  historyVersion: number;
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
    cardFolders: [],
    workspace: '' as string | null,
    workspaces: [],
    mainName: 'Main',
    hiddenGroups: [],
    hiddenCardFolders: [],
    elsewhere: [],
    save: { state: 'idle' as SaveState, message: '' },
    filter: { kind: 'all' } as Filter,
    query: '',
    sort: 'updated' as SortKey,
    historyVersion: 0,
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
