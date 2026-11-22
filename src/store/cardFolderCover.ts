/** The picture of a card folder or section: shown in its heading and at the top of it. Stored like any picture, so it syncs, backs up and is cleaned up with them. */
import { getStorage, scheduleGroupsSave, set } from './notes';
import { prepareImage } from './images';

/** Stores the picture and makes it the folder's. Throws a message fit to show when the file can't be used. */
export async function setCardFolderCover(folderId: string, file: File): Promise<void> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const { blob } = await prepareImage(file);
  const imageId = await getStorage().putImage(blob);
  set((s) => {
    const f = s.cardFolders.find((x) => x.id === folderId);
    if (f) f.cover = imageId;
  });
  scheduleGroupsSave();
}

/** Takes the picture off. (The file itself is cleaned up later, when nothing uses it.) */
export function removeCardFolderCover(folderId: string): void {
  set((s) => {
    const f = s.cardFolders.find((x) => x.id === folderId);
    if (f) delete f.cover;
  });
  scheduleGroupsSave();
}
