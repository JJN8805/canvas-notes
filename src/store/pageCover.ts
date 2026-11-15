/** The cover picture of a page: the picture its card shows in the library instead of the automatic miniature. */
import { getStorage, mutatePage } from './notes';
import { prepareImage } from './images';

/** Stores the picture and makes it the page's cover. Throws a message fit to show when the file can't be used. */
export async function setPageCover(pageId: string, file: File): Promise<void> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const { blob } = await prepareImage(file);
  const imageId = await getStorage().putImage(blob);
  mutatePage(pageId, (p) => void (p.cover = imageId), { history: 'none' });
}

/** Takes the cover off, so the card shows the miniature of the page again. */
export function removePageCover(pageId: string) {
  mutatePage(pageId, (p) => void (p.cover = null), { history: 'none' });
}
