import { Arrow, Block, NoteColor, Page, PageDrawing, ChecklistBlock } from '../../types';
import { applyColor } from '../../lib/colors';
import { rememberStickyColor } from '../prefs';
import { deepClone } from '../../lib/util';
import { reconcile } from '../../lib/attendance';
import { history } from '../history';
import type { Draft } from 'immer';
import { get, peekStorage, set } from './state';
import { markDirty } from './save';
import { refreshAttendanceSoon } from './attendance';

/* ------------------------------------------------------------------ */
/* Page mutations                                                      */
/* ------------------------------------------------------------------ */

export type HistoryMode = 'none' | 'push' | { key: string };

export function bumpHistory() {
  set((s) => {
    s.historyVersion += 1;
  });
}

/**
 * The one way pages change. `history` controls undo:
 * 'push' = its own undo step, { key } = merged with consecutive edits that share the key,
 * 'none' = not undoable (title, tags, measurements, live drag frames).
 */
export function mutatePage(
  id: string,
  recipe: (p: Draft<Page>) => void,
  opts: { history?: HistoryMode; touch?: boolean } = {},
) {
  const before = get().pages[id];
  if (!before) return;
  const mode = opts.history ?? 'push';
  set((s) => {
    const p = s.pages[id];
    if (!p) return;
    recipe(p);
    // A tracked checklist keeps today's record in line with its checks, in the same step (so undo restores both).
    for (const b of p.blocks) if (b.type === 'checklist' && b.track) reconcile(b as ChecklistBlock);
    if (opts.touch !== false) p.updated = Date.now();
  });
  const after = get().pages[id];
  if (!after || after === before) return;
  if (mode !== 'none' && (after.blocks !== before.blocks || after.arrows !== before.arrows)) {
    history.record(id, { blocks: before.blocks, arrows: before.arrows }, typeof mode === 'object' ? mode.key : null);
    bumpHistory();
  }
  markDirty(id);
  if (after.blocks !== before.blocks && after.blocks.some((b) => b.type === 'checklist' && b.track)) refreshAttendanceSoon(id);
}

/** Replaces the page's drawing (null = nothing drawn). Excalidraw keeps its own undo while draw mode is open. */
export function setPageDrawing(pageId: string, drawing: PageDrawing | null) {
  mutatePage(
    pageId,
    (p) => {
      p.drawing = drawing;
    },
    { history: 'none' },
  );
}

/** Colours the given boxes (null = no colour) as one undo step, and marks the page changed so it syncs. */
export function setColor(pageId: string, ids: readonly string[], color: NoteColor | null) {
  const page = get().pages[pageId];
  if (!page) return;
  // Checked on a copy first, so choosing the colour a box already has records no undo step.
  if (!applyColor(deepClone(page.blocks) as Block[], ids, color)) return;
  mutatePage(pageId, (p) => void applyColor(p.blocks as Block[], ids, color));
  // The next sticky starts with the colour last picked for a sticky.
  if (color && page.blocks.some((b) => b.type === 'sticky' && ids.includes(b.id))) rememberStickyColor(color, peekStorage());
}

/** The colour of the page's card in the library. Not part of the canvas undo history. */
export function setPageColor(pageId: string, color: NoteColor | null) {
  if ((get().pages[pageId]?.color ?? null) === color) return;
  mutatePage(
    pageId,
    (p) => {
      p.color = color;
    },
    { history: 'none' },
  );
}

export function updateBlock<T extends Block>(
  pageId: string,
  blockId: string,
  recipe: (b: Draft<T>) => void,
  opts?: { history?: HistoryMode; touch?: boolean },
) {
  mutatePage(
    pageId,
    (p) => {
      const b = p.blocks.find((x) => x.id === blockId);
      if (b) recipe(b as Draft<T>);
    },
    opts,
  );
}

export function beginGesture(pageId: string) {
  const p = get().pages[pageId];
  if (p) history.beginGesture(pageId, { blocks: p.blocks, arrows: p.arrows });
}
export function endGesture(pageId: string) {
  const p = get().pages[pageId];
  if (!p) return;
  if (history.endGesture(pageId, { blocks: p.blocks, arrows: p.arrows })) {
    bumpHistory();
    mutatePage(pageId, () => {}, { history: 'none' });
  }
}

export function undo(pageId: string): boolean {
  const cur = get().pages[pageId];
  if (!cur) return false;
  const prev = history.undo(pageId, { blocks: cur.blocks, arrows: cur.arrows });
  if (!prev) return false;
  set((s) => {
    s.pages[pageId].blocks = prev.blocks as Draft<Block>[];
    s.pages[pageId].arrows = prev.arrows as Draft<Arrow>[];
    s.pages[pageId].updated = Date.now();
  });
  bumpHistory();
  markDirty(pageId);
  return true;
}

export function redo(pageId: string): boolean {
  const cur = get().pages[pageId];
  if (!cur) return false;
  const next = history.redo(pageId, { blocks: cur.blocks, arrows: cur.arrows });
  if (!next) return false;
  set((s) => {
    s.pages[pageId].blocks = next.blocks as Draft<Block>[];
    s.pages[pageId].arrows = next.arrows as Draft<Arrow>[];
    s.pages[pageId].updated = Date.now();
  });
  bumpHistory();
  markDirty(pageId);
  return true;
}

