/**
 * Copy / Cut / Paste for pages and cards, across workspaces. What is copied is only a list of ids (kept for this session, never stored): Paste
 * works from the stored copies, so the pages can be in any workspace when they are copied and any other when they are pasted.
 * Copy leaves the originals and pastes new ones; Cut pastes the originals themselves (a move).
 */
import { create } from 'zustand';
import { get } from './notes';
import { toast } from './ui';
import { copyPagesToWorkspace, movePagesToWorkspace } from './workspaces';

export interface PageClip {
  ids: string[];
  mode: 'copy' | 'cut';
  /** The workspace they were taken from ('' = Main). */
  from: string;
  /** Cards or pages, for wording. */
  noun: 'page' | 'card' | 'item';
}

export const usePageClipboard = create<{ clip: PageClip | null }>(() => ({ clip: null }));

const nounOf = (ids: string[]): PageClip['noun'] => {
  const pages = get().pages;
  const kinds = new Set(ids.map((id) => (pages[id]?.kind === 'card' ? 'card' : 'page')));
  return kinds.size === 1 ? (kinds.has('card') ? 'card' : 'page') : 'item';
};
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

function put(ids: string[], mode: PageClip['mode']) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  usePageClipboard.setState({ clip: { ids: unique, mode, from: get().workspace ?? '', noun: nounOf(unique) } });
  toast(`${mode === 'copy' ? 'Copied' : 'Cut'} ${plural(unique.length, nounOf(unique))}. Open another workspace and choose Paste there.`);
}
export const copyPages = (ids: string[]) => put(ids, 'copy');
export const cutPages = (ids: string[]) => put(ids, 'cut');
export const clearPageClipboard = () => usePageClipboard.setState({ clip: null });

/** Puts what was copied or cut into the open workspace (in `groupId` when given: the card folder or group that is open). Returns how many arrived. */
export async function pasteHere(opts: { groupId?: string | null } = {}): Promise<number> {
  const clip = usePageClipboard.getState().clip;
  if (!clip) return 0;
  const target = get().workspace ?? '';
  const n = clip.mode === 'copy' ? await copyPagesToWorkspace(clip.ids, target, { quiet: true, groupId: opts.groupId }) : await movePagesToWorkspace(clip.ids, target, { quiet: true, groupId: opts.groupId });
  if (!n) {
    toast(clip.mode === 'cut' ? 'Those are already in this workspace, or can’t be moved.' : 'Nothing could be pasted.');
    if (clip.mode === 'cut') clearPageClipboard();
    return 0;
  }
  if (clip.mode === 'cut') clearPageClipboard();
  toast(`Pasted ${plural(n, clip.noun)} into this workspace.`);
  return n;
}
