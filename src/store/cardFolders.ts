/** Making and changing card folders and sections. The pure rules are in `lib/cardFolders.ts`; saving and sync go through the notes store. */
import type { Group, GroupColor } from '../types';
import { effectiveParents } from '../lib/groups';
import { cardsInPageGroups, cleanDescription, folderOfCard, planLegacyMove, reordered, startColor, uniqueName, validMoveTargets } from '../lib/cardFolders';
import { cardsOf } from '../lib/pages';
import { newId } from '../lib/util';
import { get, scheduleGroupsSave, set, setPageGroup } from './notes';

/** A new folder (at the top) or section (inside another). Null when the place it should go in no longer exists. */
export function createCardFolder(name: string, parentId: string | null = null): Group | null {
  const folders = get().cardFolders;
  if (parentId && !folders.some((f) => f.id === parentId)) return null;
  const ws = get().workspace ?? '';
  const g: Group = { id: newId(), name: uniqueName(folders, parentId, name), color: startColor(folders, parentId), parentId, scope: 'cards', ...(ws ? { workspace: ws } : {}) };
  set((s) => {
    s.cardFolders.push(g);
  });
  scheduleGroupsSave();
  return g;
}

export function renameCardFolder(id: string, name: string) {
  const clean = name.trim().slice(0, 60);
  if (!clean) return;
  set((s) => {
    const f = s.cardFolders.find((x) => x.id === id);
    if (f) f.name = clean;
  });
  scheduleGroupsSave();
}

/**
 * Changes a folder or section's name and description together (one save). An empty name is ignored, so a name cannot be erased;
 * an empty description removes the description.
 */
export function updateCardFolder(id: string, patch: { name?: string; description?: string }) {
  set((s) => {
    const f = s.cardFolders.find((x) => x.id === id);
    if (!f) return;
    const name = patch.name?.trim().slice(0, 60);
    if (name) f.name = name;
    if (patch.description !== undefined) {
      const d = cleanDescription(patch.description);
      if (d) f.description = d;
      else delete f.description;
    }
  });
  scheduleGroupsSave();
}

export function setCardFolderColor(id: string, color: GroupColor) {
  set((s) => {
    const f = s.cardFolders.find((x) => x.id === id);
    if (f) f.color = color;
  });
  scheduleGroupsSave();
}

/** Moves a folder or section, with everything inside it, into another place or to the top. False when that would put it inside itself. */
export function moveCardFolder(id: string, parentId: string | null): boolean {
  if (parentId && !validMoveTargets(get().cardFolders, id).some((f) => f.id === parentId)) return false;
  set((s) => {
    const i = s.cardFolders.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [f] = s.cardFolders.splice(i, 1);
    f.parentId = parentId;
    s.cardFolders.push(f); // arrives last among its new neighbours
  });
  scheduleGroupsSave();
  return true;
}

/** Moves a folder or section one place up or down among its neighbours (the order they are shown in). False when it is already at that end. */
export function reorderCardFolder(id: string, dir: -1 | 1): boolean {
  const next = reordered(get().cardFolders, id, dir);
  if (!next) return false;
  set((s) => {
    s.cardFolders = next;
  });
  scheduleGroupsSave();
  return true;
}

/**
 * Deletes one folder or section. Nothing inside it is lost: its sections and its cards move up into the place it was in
 * (or to "Unfiled" when it was at the top). Returns how many of each moved.
 */
export function deleteCardFolder(id: string): { cards: number; sections: number } {
  const folders = get().cardFolders;
  if (!folders.some((f) => f.id === id)) return { cards: 0, sections: 0 };
  const parent = effectiveParents(folders).get(id) ?? null;
  const cards = cardsOf(get().pages).filter((c) => c.groupId === id);
  const sections = folders.filter((f) => f.parentId === id).length;
  set((s) => {
    for (const f of s.cardFolders) if (f.parentId === id) f.parentId = parent;
    s.cardFolders = s.cardFolders.filter((f) => f.id !== id);
  });
  for (const c of cards) setPageGroup(c.id, parent);
  scheduleGroupsSave();
  return { cards: cards.length, sections };
}

/** Puts a card in a folder or section, or (null) takes it out of any. */
export function fileCard(cardId: string, folderId: string | null) {
  if (folderId && !get().cardFolders.some((f) => f.id === folderId)) return;
  setPageGroup(cardId, folderId);
}

/** How many cards are still filed under page groups from before card folders, which show as unfiled. */
export function legacyCardCount(): number {
  return cardsInPageGroups(cardsOf(get().pages), get().groups, get().cardFolders).length;
}

/** Brings those cards into card folders that copy the page groups they were in (the page groups themselves are untouched). */
export function moveLegacyCards(): { folders: number; cards: number } {
  const plan = planLegacyMove(cardsOf(get().pages), get().groups, get().cardFolders, newId);
  if (!plan.assign.size) return { folders: 0, cards: 0 };
  set((s) => {
    const ws = get().workspace ?? '';
    s.cardFolders.push(...plan.create.map((f) => (ws ? { ...f, workspace: ws } : f)));
  });
  scheduleGroupsSave();
  for (const [cardId, folderId] of plan.assign) setPageGroup(cardId, folderId);
  return { folders: plan.create.length, cards: plan.assign.size };
}

export { folderOfCard };
