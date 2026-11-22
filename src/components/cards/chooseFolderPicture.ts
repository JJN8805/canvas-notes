import { removeCardFolderCover, setCardFolderCover } from '../../store/cardFolderCover';
import { toast } from '../../store/ui';
import { get } from '../../store/notes';

/** Opens the file picker, then makes the chosen picture the folder's or section's. Nothing happens if the picker is cancelled. */
export function chooseFolderPicture(folderId: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const before = get().cardFolders.find((f) => f.id === folderId)?.cover;
    setCardFolderCover(folderId, file).then(
      () => toast('Picture set.', { label: 'Undo', run: () => (before ? void restore(folderId, before) : removeCardFolderCover(folderId)) }, 6000),
      (e) => toast(`The picture couldn’t be set: ${e instanceof Error ? e.message : e}`),
    );
  };
  input.click();
}

async function restore(folderId: string, cover: string) {
  const { set, scheduleGroupsSave } = await import('../../store/notes');
  set((s) => {
    const f = s.cardFolders.find((x) => x.id === folderId);
    if (f) f.cover = cover;
  });
  scheduleGroupsSave();
}
