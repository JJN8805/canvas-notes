import { flushSync } from 'react-dom';
import type { AddKind, Block } from '../../types';
import { addBlock, deleteBlocks, duplicateBlocks, getStorage, setLocked, undo, useNotes } from '../../store/notes';
import { canvasApi, freshText, setHand, setSelected, useCanvas, type Point } from '../../store/canvas';
import { toast, type MenuItem } from '../../store/ui';
import { setMinimap, usePrefs } from '../../store/prefs';
import { openShortcuts } from '../../store/shortcutsUi';
import { stickyCorner } from '../../lib/colors';
import { allLocked } from '../../lib/lock';
import { hiddenBlockIds } from '../../lib/frames';
import { MOD_LABEL } from '../../lib/util';
import { noteStyleMenu } from './noteStyleMenu';
import { openLinkDialog } from '../../store/boxLinks';
import { arrangeMenu, layerMenu } from './layerMenu';

/** The boxes Select all picks: everything except what a collapsed frame hides (the same for Ctrl+A and the right-click menu). */
export function selectableIds(blocks: Block[]): string[] {
  const hidden = hiddenBlockIds(blocks);
  return blocks.filter((b) => !hidden.has(b.id)).map((b) => b.id);
}

/** Delete boxes the way every competitor does: say so, and offer Undo right there. Locked boxes stay and the toast says why. */
export function deleteWithUndo(pageId: string, ids: string[]): number {
  const n = deleteBlocks(pageId, ids);
  if (!n) {
    if (ids.length) toast(ids.length === 1 ? 'That box is locked. Unlock it to delete it.' : 'Those boxes are locked. Unlock them to delete them.');
    return 0;
  }
  setSelected([]);
  const kept = ids.length - n;
  const msg = (n === 1 ? 'Box deleted' : `${n} boxes deleted`) + (kept > 0 ? ` (${kept} locked ${kept === 1 ? 'box' : 'boxes'} kept)` : '');
  toast(msg, { label: 'Undo', run: () => void undo(pageId) }, 6000, pageId);
  return n;
}

/* ------------------------------------------------------------------ */
/* Right-click menus and quick-add                                      */
/* ------------------------------------------------------------------ */

const ADD_LABEL: Partial<Record<AddKind, string>> = { text: 'Text note', sticky: 'Sticky note', checklist: 'List', code: 'Code note', table: 'Table', frame: 'Frame' };

/** Puts a new box of `type` where the pointer is (its top-left, or centred for a sticky), selects it and starts typing in it. */
export function quickAdd(pageId: string, type: AddKind, at: Point, focus: (id: string) => void): string {
  const spot = type === 'sticky' ? stickyCorner(at) : { x: Math.round(at.x / 8) * 8, y: Math.round(at.y / 8) * 8 };
  let id = '';
  flushSync(() => {
    id = addBlock(pageId, type, spot);
    if (type === 'text') freshText.add(id);
    setSelected([id]);
  });
  if (type !== 'frame') focus(id);
  return id;
}

/** Tab on a selected box: a new sticky to its right, joined to it by an arrow, ready to type in (FigJam, Miro mind maps). */
export function branchFrom(pageId: string, fromId: string, focus: (id: string) => void): string {
  const b = useNotes.getState().pages[pageId]?.blocks.find((x) => x.id === fromId);
  if (!b) return '';
  let id = '';
  flushSync(() => {
    id = addBlock(pageId, 'sticky', { x: b.x + b.w + 72, y: b.y }, b.tint ? { tint: b.tint } : {}, { arrowFrom: fromId });
    setSelected([id]);
  });
  focus(id);
  return id;
}

/** The menu for one or several boxes. */
export function boxMenu(pageId: string, ids: string[]): MenuItem[] {
  const blocks = useNotes.getState().pages[pageId]?.blocks ?? [];
  const locked = allLocked(blocks, ids);
  const items: MenuItem[] = [
    { label: `Duplicate  (${MOD_LABEL}+D)`, action: () => setSelected(duplicateBlocks(pageId, ids)) },
    { label: locked ? `Unlock  (${MOD_LABEL}+Shift+L)` : `Lock in place  (${MOD_LABEL}+Shift+L)`, action: () => setLocked(pageId, ids, !locked) },
    ...(ids.length === 1 ? [{ label: 'Links…', action: () => openLinkDialog(pageId, ids[0]) } as MenuItem] : []),
    ...noteStyleMenu(pageId, blocks, ids),
    { separator: true },
    ...layerMenu(pageId, ids),
  ];
  if (ids.length > 1) items.push({ separator: true }, ...arrangeMenu(pageId, ids));
  items.push({ separator: true }, { label: 'Delete  (Del)', danger: true, action: () => void deleteWithUndo(pageId, ids) });
  return items;
}

/** The menu for empty canvas: add something right here, select all, find your way around. */
export function canvasMenu(pageId: string, at: Point, focus: (id: string) => void): MenuItem[] {
  const api = canvasApi.current;
  const add = (type: AddKind): MenuItem => ({ label: ADD_LABEL[type] ?? type, action: () => void quickAdd(pageId, type, at, focus) });
  const blocks = useNotes.getState().pages[pageId]?.blocks ?? [];
  return [
    { heading: 'Add here' },
    add('text'),
    add('sticky'),
    add('checklist'),
    add('code'),
    add('table'),
    add('frame'),
    { separator: true },
    { label: `Select all  (${MOD_LABEL}+A)`, action: () => setSelected(selectableIds(blocks)) },
    { label: `Zoom to fit  (${MOD_LABEL}+1)`, action: () => api?.fit() },
    { label: `Hand tool  (${usePrefs.getState().keymap.hand})`, check: useCanvas.getState().hand, action: () => setHand(!useCanvas.getState().hand) },
    { label: `Show the map  (${usePrefs.getState().keymap.minimap})`, check: usePrefs.getState().minimap, action: () => setMinimap(!usePrefs.getState().minimap, getStorage()) },
    { label: 'Keyboard shortcuts  (?)', action: openShortcuts },
  ];
}
