import { mutatePage, useNotes } from './notes';
import { toast } from './ui';
import { canArchive, isArchived } from '../lib/pages';

/**
 * Put a page or card in the Archive: it stays stored, synced and backed up, with its pictures and files, but leaves the library, search and
 * counts. Not an edit of the page (its "last edited" time is left alone). Templates, the journal's day pages and attendance pages cannot be
 * archived (`canArchive` says why). Returns whether anything changed.
 */
export function archivePage(id: string, opts: { announce?: boolean } = {}): boolean {
  const p = useNotes.getState().pages[id];
  if (!p || !canArchive(p) || isArchived(p)) return false;
  mutatePage(id, (d) => void (d.archived = true), { history: 'none', touch: false });
  if (opts.announce !== false) toast(`Archived “${p.title.trim() || 'Untitled'}”`, { label: 'Undo', run: () => void restorePage(id, { announce: false }) }, 6000);
  return true;
}

/** Bring a page or card back from the Archive. */
export function restorePage(id: string, opts: { announce?: boolean } = {}): boolean {
  const p = useNotes.getState().pages[id];
  if (!p || !isArchived(p)) return false;
  mutatePage(id, (d) => void delete d.archived, { history: 'none', touch: false });
  if (opts.announce !== false) toast(`Restored “${p.title.trim() || 'Untitled'}”`);
  return true;
}
