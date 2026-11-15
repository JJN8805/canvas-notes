import type { MenuItem } from '../../store/ui';
import { arrangeBlocks, bringToFront, sendToBack, setOverDrawing, useNotes } from '../../store/notes';
import { liveDrawing } from '../../lib/drawing';
import { markTargets } from '../../lib/layers';
import { MOD_LABEL } from '../../lib/util';

/**
 * The layer menu for one or several boxes: to the front or the back, and (when the page has a drawing) over or under it. Moving a box
 * one place at a time is on the keyboard only (Ctrl+] and Ctrl+[), to keep the menu short.
 */
export function layerMenu(pageId: string, ids: string[]): MenuItem[] {
  const page = useNotes.getState().pages[pageId];
  const items: MenuItem[] = [
    { heading: 'Layer' },
    { label: `Bring to front  (${MOD_LABEL}+Shift+])`, action: () => bringToFront(pageId, ids, { undoable: true }) },
    { label: `Send to back  (${MOD_LABEL}+Shift+[)`, action: () => sendToBack(pageId, ids) },
  ];
  if (page && liveDrawing(page.drawing) && !page.drawing?.behind) {
    const targets = markTargets(page.blocks, ids);
    const allOver = targets.length > 0 && targets.every((id) => !!page.blocks.find((b) => b.id === id)?.over);
    const inFrame = targets.some((t) => !ids.includes(t));
    items.push(
      { separator: true },
      { label: inFrame ? 'Above the drawing (with its frame)' : 'Above the drawing', check: allOver, action: () => setOverDrawing(pageId, ids, !allOver) },
    );
  }
  return items;
}

/** Align the boxes on an edge or centre line, or spread them evenly (spreading needs three or more). */
export function arrangeMenu(pageId: string, ids: string[]): MenuItem[] {
  const alt = MOD_LABEL === 'Ctrl' ? 'Alt' : '⌥';
  const spread = ids.length >= 3;
  const items: MenuItem[] = [
    { heading: 'Align' },
    { label: `Left  (${alt}+A)`, action: () => arrangeBlocks(pageId, ids, 'left') },
    { label: `Centre across  (${alt}+H)`, action: () => arrangeBlocks(pageId, ids, 'center-x') },
    { label: `Right  (${alt}+D)`, action: () => arrangeBlocks(pageId, ids, 'right') },
    { separator: true },
    { label: `Top  (${alt}+W)`, action: () => arrangeBlocks(pageId, ids, 'top') },
    { label: `Middle  (${alt}+V)`, action: () => arrangeBlocks(pageId, ids, 'center-y') },
    { label: `Bottom  (${alt}+S)`, action: () => arrangeBlocks(pageId, ids, 'bottom') },
  ];
  if (spread) {
    items.push(
      { separator: true },
      { label: `Spread across  (${alt}+Shift+H)`, action: () => arrangeBlocks(pageId, ids, { distribute: 'x' }) },
      { label: `Spread down  (${alt}+Shift+V)`, action: () => arrangeBlocks(pageId, ids, { distribute: 'y' }) },
    );
  }
  return items;
}
