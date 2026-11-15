import { useState } from 'react';
import { fileCard, moveCardFolder } from '../../store/cardFolders';
import { toast } from '../../store/ui';

export const CARD_MIME = 'application/x-canvas-card';
export const CARD_FOLDER_MIME = 'application/x-canvas-card-folder';

const has = (e: React.DragEvent) => e.dataTransfer.types.includes(CARD_MIME) || e.dataTransfer.types.includes(CARD_FOLDER_MIME);

/**
 * Makes something a place to drop cards and folders on: a card dropped on it is filed there, a folder or section dropped on it moves
 * inside it. `folderId` null is the top ("not in a folder" for a card, the top level for a folder).
 */
export function useFolderDrop(folderId: string | null, name: string) {
  const [over, setOver] = useState(false);
  const props = {
    onDragOver: (e: React.DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      const card = e.dataTransfer.getData(CARD_MIME);
      if (card) {
        fileCard(card, folderId);
        toast(folderId ? `Moved to ${name}` : 'Taken out of its folder');
        return;
      }
      const folder = e.dataTransfer.getData(CARD_FOLDER_MIME);
      if (folder && folder !== folderId) {
        if (moveCardFolder(folder, folderId)) toast(folderId ? `Moved into ${name}` : 'Moved to the top level');
        else toast('A folder can’t go inside itself or one of its own sections.');
      }
    },
  };
  return { over, props };
}
