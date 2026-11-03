/** Making and changing cards. Pure card logic is in `lib/cards.ts`; saving, undo-free edits and sync go through the notes store. */
import type { Page } from '../types';
import { cardParts, newBody, newCardBlocks, withCover } from '../lib/cards';
import { createPage, getStorage, mutatePage, setPageGroup, useNotes } from './notes';
import { prepareImage } from './images';

export function createCard(label = '', groupId: string | null = null): Page {
  return createPage({ kind: 'card', title: label, blocks: newCardBlocks(), groupId, tags: [] });
}

export function setCardTags(id: string, tags: string[]) {
  mutatePage(id, (p) => void (p.tags = tags), { history: 'none' });
}

/** Puts the card in a group (its set), or in none. */
export function setCardSet(id: string, groupId: string | null) {
  setPageGroup(id, groupId);
}

export function setCardLabel(id: string, label: string) {
  mutatePage(id, (p) => void (p.title = label), { history: 'none' });
}

/** Stores the picture and makes it the card's cover. Throws a message fit to show when the file can't be used. */
export async function setCardCover(id: string, file: File): Promise<void> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const { blob, width, height } = await prepareImage(file);
  const imageId = await getStorage().putImage(blob);
  mutatePage(id, (p) => void (p.blocks = withCover(p.blocks, { imageId, aspect: width / height })), { history: 'none' });
}

export function removeCardCover(id: string) {
  mutatePage(id, (p) => void (p.blocks = withCover(p.blocks, null)), { history: 'none' });
}

/** A card whose details box was deleted on the canvas gets a fresh one, so there is always somewhere to write. */
export function ensureCardBody(id: string) {
  const page = useNotes.getState().pages[id];
  if (!page || cardParts(page).body) return;
  const { cover } = cardParts(page);
  mutatePage(id, (p) => void p.blocks.push({ ...newBody(cover ? cover.h + 24 : 0), z: p.blocks.reduce((m, b) => Math.max(m, b.z || 0), 0) + 1 }), { history: 'none' });
}
