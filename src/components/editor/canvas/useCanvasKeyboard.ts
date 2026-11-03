import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { Block } from '../../../types';
import { addBlock, deleteArrows, deleteBlocks, duplicateBlocks, mutatePage, redo, undo } from '../../../store/notes';
import { addImages, imageFiles } from '../../../store/images';
import { setSelected, setSelectedArrow, useCanvas, type Point } from '../../../store/canvas';
import { useUi } from '../../../store/ui';
import { useDraw } from '../../../store/draw';
import { isStickyKey, STICKY_SIZE, stickyCorner } from '../../../lib/colors';
import { isActivatable, isEditableTarget, isTextEntry, modKey, sanitizeHtml, textToHtml } from '../../../lib/util';
import { frameDescendants, hiddenBlockIds } from '../../../lib/frames';

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
}

/** Keyboard shortcuts (undo, zoom, delete, nudge, S for a sticky…), Space-to-pan and pasting onto the canvas. */
export function useCanvasKeyboard(deps: KeyboardDeps) {
  const { pageId, viewportRef, worldRef, blocksRef, pointer, spaceDown, setPanMode, focusBlock, visibleSpot, zoomTo, worldPoint, fitContent } = deps;
  useEffect(() => {
    // Any open dialog, menu, drawing or panel (settings, outline, history, palette…) owns the keyboard.
    const blocked = () =>
      !!(useUi.getState().dialog || useUi.getState().menu || useDraw.getState().open || document.querySelector('.scrim, [aria-modal="true"]'));

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
        }
        return;
      }
      const mod = modKey(e);
      const key = e.key.toLowerCase();
      // Space and Enter on a focused button, link or checkbox do their normal job.
      if ((e.key === ' ' || e.key === 'Enter') && isActivatable(a)) return;

      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
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
        const hidden = hiddenBlockIds(blocksRef.current);
        setSelected(blocksRef.current.filter((b) => !hidden.has(b.id)).map((b) => b.id));
        return;
      }

      if (isStickyKey(e)) {
        // At the pointer if it is over the canvas, otherwise in the middle of what is visible.
        e.preventDefault();
        const r = viewportRef.current?.getBoundingClientRect();
        const m = pointer.current;
        const over = !!(r && m && m.x >= r.left && m.x <= r.right && m.y >= r.top && m.y <= r.bottom);
        const at = over ? stickyCorner(worldPoint(m!.x, m!.y)) : visibleSpot(STICKY_SIZE, STICKY_SIZE);
        let id = '';
        flushSync(() => {
          id = addBlock(pageId, 'sticky', at);
          setSelected([id]);
        });
        focusBlock(id);
        return;
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
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteBlocks(pageId, sel);
        setSelected([]);
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
        const nudgeIds = new Set(sel);
        for (const sid of sel) {
          const b = blocksRef.current.find((x) => x.id === sid);
          if (b?.type === 'frame') for (const d of frameDescendants(blocksRef.current, sid)) nudgeIds.add(d);
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
        spaceDown.current = false;
        setPanMode((m) => (m === 'panning' ? m : 'off'));
      }
    };
    const onBlur = () => {
      spaceDown.current = false;
      setPanMode('off');
    };

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
    };
  }, [pageId, focusBlock, visibleSpot, zoomTo, worldPoint, fitContent]);
}
