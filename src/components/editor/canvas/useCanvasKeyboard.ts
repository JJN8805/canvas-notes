import { useEffect } from 'react';
import { cycleNoteStyle } from '../noteStyle';
import { Block, type AddKind } from '../../../types';
import { addBlock, arrangeBlocks, getStorage, setLocked, bringToFront, deleteArrows, duplicateBlocks, mutatePage, redo, sendToBack, stepBlocks, undo } from '../../../store/notes';
import { addImages, imageFiles } from '../../../store/images';
import { deleteWithUndo } from '../actions';
import { setHand, setSelected, setSelectedArrow, useCanvas, type Point } from '../../../store/canvas';
import { useUi } from '../../../store/ui';
import { useDraw } from '../../../store/draw';
import { STICKY_SIZE } from '../../../lib/colors';
import { actionFor } from '../../../lib/keymap';
import { isActivatable, isEditableTarget, isTextEntry, modKey, sanitizeHtml, textToHtml } from '../../../lib/util';
import { frameDescendants } from '../../../lib/frames';
import { allLocked, freeIds } from '../../../lib/lock';
import { branchFrom, quickAdd, selectableIds } from '../actions';
import { openShortcuts } from '../../../store/shortcutsUi';
import { setMinimap, usePrefs } from '../../../store/prefs';
import type { AlignMode } from '../../../lib/arrange';

export type PanMode = 'off' | 'ready' | 'panning';

export interface KeyboardDeps {
  pageId: string;
  viewportRef: { current: HTMLDivElement | null };
  worldRef: { current: HTMLDivElement | null };
  blocksRef: { current: Block[] };
  /** Where the pointer last was (screen coordinates), so "S" can drop a sticky under it. */
  pointer: { current: Point | null };
  spaceDown: { current: boolean };
  setPanMode: (update: PanMode | ((m: PanMode) => PanMode)) => void;
  focusBlock: (id: string) => void;
  visibleSpot: (w: number, h: number) => Point;
  zoomTo: (next: number, anchor?: Point) => void;
  worldPoint: (clientX: number, clientY: number) => Point;
  fitContent: () => void;
  /** Zoom and scroll so the selected boxes fill the view. */
  fitSelection: () => void;
}

/** Keyboard shortcuts (undo, zoom, delete, nudge, S for a sticky…), Space-to-pan and pasting onto the canvas. */
export function useCanvasKeyboard(deps: KeyboardDeps) {
  const { pageId, viewportRef, worldRef, blocksRef, pointer, spaceDown, setPanMode, focusBlock, visibleSpot, zoomTo, worldPoint, fitContent, fitSelection } = deps;
  useEffect(() => {
    // Any open dialog, menu, drawing or panel (settings, outline, history, palette…) owns the keyboard.
    const blocked = () =>
      !!(useUi.getState().dialog || useUi.getState().menu || useDraw.getState().open || document.querySelector('.scrim, [aria-modal="true"]'));

    let spaceHeld = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (blocked()) return;
      const a = document.activeElement;
      // Undo still works right after ticking a checkbox, which holds focus but takes no text.
      const undoKey = modKey(e) && ['z', 'y'].includes(e.key.toLowerCase());
      if (isEditableTarget(a) && !(undoKey && !isTextEntry(a))) {
        if (e.key === 'Escape' && a instanceof HTMLElement && worldRef.current?.contains(a)) {
          a.blur();
          const id = a.closest<HTMLElement>('[data-id]')?.dataset.id;
          if (id) setSelected([id]);
        } else if (e.key === 'Tab' && !modKey(e) && !e.altKey && !e.shiftKey && a instanceof HTMLElement && worldRef.current?.contains(a)) {
          // Tab while typing in a sticky starts the next one, joined by an arrow (FigJam). Elsewhere Tab keeps its normal job.
          const id = a.closest<HTMLElement>('.b-sticky')?.dataset.id;
          if (id) {
            e.preventDefault();
            branchFrom(pageId, id, focusBlock);
          }
        }
        return;
      }
      const mod = modKey(e);
      const key = e.key.toLowerCase();
      if (e.key === 'Escape' && useCanvas.getState().hand) {
        e.preventDefault();
        setHand(false);
        return;
      }
      // Space and Enter on a focused button, link or checkbox do their normal job.
      if ((e.key === ' ' || e.key === 'Enter') && isActivatable(a)) return;

      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        spaceHeld = true;
        spaceDown.current = true;
        setPanMode((m) => (m === 'panning' ? m : 'ready'));
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(pageId);
        else undo(pageId);
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        redo(pageId);
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomTo(useCanvas.getState().zoom * 1.2);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        zoomTo(useCanvas.getState().zoom / 1.2);
        return;
      }
      if (mod && e.key === '1') {
        e.preventDefault();
        fitContent();
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        zoomTo(1);
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        setSelected(selectableIds(blocksRef.current));
        return;
      }

      if (e.key === '?' && !mod) {
        e.preventDefault();
        openShortcuts();
        return;
      }
      if (mod && e.shiftKey && key === 'l') {
        e.preventDefault();
        const picked = useCanvas.getState().selected;
        if (picked.length) setLocked(pageId, picked, !allLocked(blocksRef.current, picked));
        return;
      }
      if (e.key === 'Tab' && !mod && !e.altKey && !e.shiftKey && !isActivatable(a) && useCanvas.getState().selected.length === 1) {
        e.preventDefault();
        branchFrom(pageId, useCanvas.getState().selected[0], focusBlock);
        return;
      }

      // One-letter keys (Settings → About → Keyboard shortcuts can change them): add a box at the pointer or mid-view, map, hand tool.
      const action = !mod && !e.altKey && !e.shiftKey && !e.repeat ? actionFor(usePrefs.getState().keymap, e.code) : null;
      if (action === 'minimap') {
        e.preventDefault();
        setMinimap(!usePrefs.getState().minimap, getStorage());
        return;
      }
      if (action === 'hand') {
        e.preventDefault();
        setHand(!useCanvas.getState().hand);
        return;
      }
      if (action) {
        e.preventDefault();
        const size: Record<string, [AddKind, number, number]> = {
          sticky: ['sticky', STICKY_SIZE, STICKY_SIZE], text: ['text', 280, 40], checklist: ['checklist', 288, 48], code: ['code', 432, 72], table: ['table', 384, 120], frame: ['frame', 360, 240],
        };
        const [type, w, h] = size[action];
        const r = viewportRef.current?.getBoundingClientRect();
        const m = pointer.current;
        const over = !!(r && m && m.x >= r.left && m.x <= r.right && m.y >= r.top && m.y <= r.bottom);
        // At the pointer if it is over the canvas, otherwise in the middle of what is visible.
        quickAdd(pageId, type, over ? worldPoint(m!.x, m!.y) : visibleSpot(w, h), focusBlock);
        return;
      }

      // Shift+2: zoom to the selection (Figma, tldraw). Align with Alt+A/D/W/S/H/V, spread with Alt+Shift+H/V (Figma, Miro).
      if (e.shiftKey && !mod && e.code === 'Digit2' && useCanvas.getState().selected.length) {
        e.preventDefault();
        fitSelection();
        return;
      }
      if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyN') {
        const picked = useCanvas.getState().selected;
        if (picked.length) {
          e.preventDefault();
          void cycleNoteStyle(pageId, picked);
          return;
        }
      }
      if (e.altKey && !mod) {
        const picked = useCanvas.getState().selected;
        const alignKeys: Record<string, AlignMode> = { KeyA: 'left', KeyD: 'right', KeyW: 'top', KeyS: 'bottom', KeyH: 'center-x', KeyV: 'center-y' };
        if (picked.length > 1 && (e.code in alignKeys || (e.shiftKey && (e.code === 'KeyH' || e.code === 'KeyV')))) {
          e.preventDefault();
          if (e.shiftKey) arrangeBlocks(pageId, picked, { distribute: e.code === 'KeyH' ? 'x' : 'y' });
          else arrangeBlocks(pageId, picked, alignKeys[e.code]);
          return;
        }
      }

      const sel = useCanvas.getState().selected;
      if (!sel.length) {
        const arrowSel = useCanvas.getState().selectedArrow;
        if (arrowSel && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault();
          deleteArrows(pageId, [arrowSel]);
          setSelectedArrow(null);
        } else if (arrowSel && e.key === 'Escape') {
          setSelectedArrow(null);
        }
        return;
      }
      if (mod && !e.altKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        // Ctrl+] / Ctrl+[ one place forward / backward; with Shift, all the way to the front / back.
        e.preventDefault();
        const forward = e.code === 'BracketRight';
        if (e.shiftKey) {
          if (forward) bringToFront(pageId, sel, { undoable: true });
          else sendToBack(pageId, sel);
        } else stepBlocks(pageId, sel, forward ? 'forward' : 'backward');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteWithUndo(pageId, sel);
      } else if (mod && key === 'd' && !e.altKey) {
        e.preventDefault();
        setSelected(duplicateBlocks(pageId, sel));
      } else if (e.key === 'Escape') {
        setSelected([]);
      } else if (e.key === 'Enter' && sel.length === 1) {
        e.preventDefault();
        focusBlock(sel[0]);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 8;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        // Nudging a frame also nudges everything nested inside it.
        const nudgeIds = new Set(freeIds(blocksRef.current, sel));
        for (const sid of sel) {
          const b = blocksRef.current.find((x) => x.id === sid);
          if (b?.type === 'frame' && !b.locked) for (const d of frameDescendants(blocksRef.current, sid)) nudgeIds.add(d);
        }
        mutatePage(
          pageId,
          (p) => {
            for (const b of p.blocks) {
              if (!nudgeIds.has(b.id)) continue;
              b.x += dx;
              b.y += dy;
            }
          },
          { history: { key: 'nudge:' + sel.join(',') } },
        );
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spaceHeld = false;
        spaceDown.current = useCanvas.getState().hand;
        setPanMode((m) => (m === 'panning' ? m : spaceDown.current ? 'ready' : 'off'));
      }
    };
    const onBlur = () => {
      spaceHeld = false;
      spaceDown.current = useCanvas.getState().hand;
      setPanMode(spaceDown.current ? 'ready' : 'off');
    };
    // The hand tool behaves like Space held down, until it is switched off.
    const syncHand = () => {
      spaceDown.current = spaceHeld || useCanvas.getState().hand;
      setPanMode((m) => (m === 'panning' ? m : spaceDown.current ? 'ready' : 'off'));
    };
    const unsubHand = useCanvas.subscribe((st, prev) => st.hand !== prev.hand && syncHand());
    syncHand();

    const onPaste = (e: ClipboardEvent) => {
      if (blocked() || isTextEntry(document.activeElement)) return;
      const files = imageFiles(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        void addImages(pageId, files, visibleSpot(360, 260)).then((ids) => ids.length && setSelected(ids));
        return;
      }
      const html = e.clipboardData?.getData('text/html');
      const text = e.clipboardData?.getData('text/plain');
      if (!html && !text) return;
      e.preventDefault();
      const id = addBlock(pageId, 'text', visibleSpot(320, 80), {
        w: 320,
        html: html ? sanitizeHtml(html) : textToHtml(text ?? ''),
      });
      setSelected([id]);
    };

    const onPointer = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onPointer);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('paste', onPaste);
      unsubHand();
    };
  }, [pageId, focusBlock, visibleSpot, zoomTo, worldPoint, fitContent, fitSelection]);
}
