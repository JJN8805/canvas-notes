import type { Block, Page } from '../src/types';
import { starterById } from '../src/lib/office/starters';

/** A Workspace page built from a starter, without the store (for tests of pure code). */
export function createOfficePageData(_app: string, starterId: string): Page {
  const built = starterById(starterId)!.build('t1');
  return { id: 'p', title: built.title, groupId: null, tags: [], blocks: built.blocks as Block[], arrows: [], created: 1, updated: 1, rev: 1 };
}
