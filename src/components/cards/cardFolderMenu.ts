import type { Group } from '../../types';
import { createCardFolder, deleteCardFolder, moveCardFolder, reorderCardFolder, setCardFolderColor } from '../../store/cardFolders';
import { ask, confirmDanger, openMenu, toast } from '../../store/ui';
import { childrenOf, depthOf, placeName, reordered, validMoveTargets } from '../../lib/cardFolders';
import { groupChoices } from '../library/shared';
import { folderWorkspaceItems } from '../library/workspaceMenu';
import { chooseFolderPicture } from './chooseFolderPicture';
import { removeCardFolderCover } from '../../store/cardFolderCover';

/** Asks for a name and makes a folder (at the top) or a section (inside `parentId`). Resolves to the new one, or null if cancelled. */
export async function promptNewFolder(folders: Group[], parentId: string | null): Promise<Group | null> {
  const kind = parentId ? 'section' : 'folder';
  const parent = parentId ? folders.find((f) => f.id === parentId) : null;
  const v = await ask({
    title: parent ? `New section in ${parent.name}` : 'New folder',
    text: parent ? 'A section is a part of a folder, with its own cards. Sections can have sections of their own.' : 'A folder holds cards, and sections to sort them into.',
    okLabel: `Create ${kind}`,
    placeholder: `${kind === 'folder' ? 'Folder' : 'Section'} name`,
  });
  if (!v?.trim()) return null;
  const made = createCardFolder(v, parentId);
  if (!made) toast('That place is gone, so nothing was created.');
  return made;
}

/** The ⋯ menu of a folder or section: new section, rename, colour, move and delete. */
export function openCardFolderMenu(anchor: HTMLElement, f: Group, folders: Group[], cardCount: number, onEdit: (f: Group) => void) {
  const depth = depthOf(folders, f.id);
  const kind = placeName(depth);
  const allowed = new Set(validMoveTargets(folders, f.id).map((x) => x.id));
  const direct = folders.filter((x) => x.parentId === f.id).length;
  openMenu(anchor, [
    { label: 'Edit name and description…', action: () => onEdit(f) },
    { label: 'New section…', action: () => void promptNewFolder(folders, f.id) },
    { swatches: true, current: f.color, pick: (c) => setCardFolderColor(f.id, c) },
    { label: f.cover ? `Change the ${kind}’s picture…` : `Add a picture to the ${kind}…`, action: () => chooseFolderPicture(f.id) },
    ...(f.cover ? [{ label: 'Remove the picture', action: () => removeCardFolderCover(f.id) }] : []),
    ...(childrenOf(folders, f.parentId).length > 1
      ? [
          { separator: true as const },
          ...(reordered(folders, f.id, -1) ? [{ label: `Move up (before the ${placeName(depth)} above)`, action: () => void reorderCardFolder(f.id, -1) }] : []),
          ...(reordered(folders, f.id, 1) ? [{ label: `Move down (after the ${placeName(depth)} below)`, action: () => void reorderCardFolder(f.id, 1) }] : []),
        ]
      : []),
    { separator: true },
    { heading: 'Move into' },
    { label: 'Top level (as a folder)', check: !f.parentId, action: () => void moveCardFolder(f.id, null) },
    ...groupChoices(folders, f.parentId, (id) => void moveCardFolder(f.id, id), allowed),
    ...folderWorkspaceItems(f, kind),
    { separator: true },
    {
      label: `Delete ${kind}…`,
      danger: true,
      action: async () => {
        const parent = f.parentId ? folders.find((x) => x.id === f.parentId) : null;
        const where = parent ? `“${parent.name}”` : 'Cards, not in a folder';
        const bits = [cardCountText(cardCount), direct ? `${direct} section${direct > 1 ? 's' : ''}` : ''].filter(Boolean);
        const ok = await confirmDanger(
          `Delete “${f.name}”?`,
          bits.length ? `Only the ${kind} itself is removed. ${bits.join(' and ').replace(/^./, (c) => c.toUpperCase())} will move up to ${where}. No cards are deleted.` : `This ${kind} is empty.`,
          `Delete ${kind}`,
        );
        if (!ok) return;
        deleteCardFolder(f.id);
        toast(`Deleted ${f.name}`);
      },
    },
  ]);
}

const cardCountText = (n: number) => (n ? `its ${n} card${n > 1 ? 's' : ''}` : '');
