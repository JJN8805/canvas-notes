import { deletePage, setPageGroup, useNotes } from './notes';
import { restoreFromTrash } from './notes/init';
import { archivePage, restorePage } from './archive';
import { toast, confirmDanger } from './ui';
import { pagesWord } from '../lib/selection';
import { canArchive } from '../lib/pages';

/** Archive the picked pages, with one message and one Undo for all of them. Returns how many were archived. */
export function archivePages(ids: string[]): number {
  const done = ids.filter((id) => archivePage(id, { announce: false }));
  if (done.length) toast(`Archived ${pagesWord(done.length)}`, { label: 'Undo', run: () => done.forEach((id) => restorePage(id, { announce: false })) }, 6000);
  else if (ids.length) toast('Those pages can’t be archived.');
  return done.length;
}

/** How many of these can go to the Archive (daily pages and attendance pages can't). */
export const archivable = (ids: string[]): string[] => ids.filter((id) => {
  const p = useNotes.getState().pages[id];
  return !!p && canArchive(p);
});

/** Ask once, then delete them all (they go to the Trash, where each can be restored) with one Undo. */
export async function deletePages(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const ok = await confirmDanger(`Delete ${pagesWord(ids.length)}?`, 'They go to the Trash, where you can restore them for a while.', 'Delete');
  if (!ok) return 0;
  for (const id of ids) await deletePage(id, { quiet: true });
  toast(`Deleted ${pagesWord(ids.length)}`, { label: 'Undo', run: () => ids.forEach((id) => restoreFromTrash(id, { quiet: true })) }, 8000);
  return ids.length;
}

/** Move the picked pages to a group (null = out of any group). */
export function movePages(ids: string[], groupId: string | null, groupName: string) {
  ids.forEach((id) => setPageGroup(id, groupId));
  toast(groupId ? `Moved ${pagesWord(ids.length)} to ${groupName}` : `Moved ${pagesWord(ids.length)} out of their groups`);
}
