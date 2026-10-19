import { create } from 'zustand';
import type { Editor } from '@tiptap/react';

export interface Point {
  x: number;
  y: number;
}

interface CanvasState {
  selected: string[];
  /** The selected arrow, if any. Mutually exclusive with a non-empty `selected`. */
  selectedArrow: string | null;
  zoom: number;
  /** The rich-text editor that currently has focus, for the formatting bar. */
  activeEditor: Editor | null;
  /** Touch screens: taps add/remove boxes from the selection instead of editing them. */
  selectMode: boolean;
}

// Plain zustand (no immer): TipTap editors must not be frozen.
export const useCanvas = create<CanvasState>(() => ({
  selected: [],
  selectedArrow: null,
  zoom: 1,
  activeEditor: null,
  selectMode: false,
}));

export function setSelected(ids: string[]) {
  const cur = useCanvas.getState();
  if (cur.selected.length === ids.length && cur.selected.every((id, i) => id === ids[i]) && !cur.selectedArrow) return;
  useCanvas.setState({ selected: ids, selectedArrow: null });
}

export function setSelectedArrow(id: string | null) {
  useCanvas.setState({ selectedArrow: id, selected: id ? [] : useCanvas.getState().selected });
}

export function setSelectMode(on: boolean) {
  useCanvas.setState(on ? { selectMode: true } : { selectMode: false, selected: [] });
  if (on) (document.activeElement as HTMLElement | null)?.blur?.();
}

export function resetCanvas() {
  useCanvas.setState({ selected: [], selectedArrow: null, zoom: 1, activeEditor: null, selectMode: false });
}

export interface CanvasView {
  zoom: number;
  left: number;
  top: number;
}

/** Imperative helpers the mounted canvas provides (coordinates, focusing). */
export interface CanvasApi {
  /** A sensible spot for a new item of the given size inside the visible area. */
  visibleSpot(w: number, h: number): Point;
  worldPoint(clientX: number, clientY: number): Point;
  focusBlock(id: string): void;
  zoomTo(zoom: number, anchor?: Point): void;
  /** The zoom and scroll position (in screen pixels) of the visible part of the page. */
  getView(): CanvasView;
  setView(view: CanvasView): void;
}
export const canvasApi: { current: CanvasApi | null } = { current: null };

/** Live TipTap editors by block id, so new text boxes can be focused. */
export const editorRegistry = new Map<string, Editor>();
