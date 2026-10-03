import { create } from 'zustand';
import type { Editor } from '@tiptap/react';

export interface Point {
  x: number;
  y: number;
}

interface CanvasState {
  selected: string[];
  zoom: number;
  /** The rich-text editor that currently has focus, for the formatting bar. */
  activeEditor: Editor | null;
  /** Touch screens: taps add/remove boxes from the selection instead of editing them. */
  selectMode: boolean;
}

// Plain zustand (no immer): TipTap editors must not be frozen.
export const useCanvas = create<CanvasState>(() => ({ selected: [], zoom: 1, activeEditor: null, selectMode: false }));

export function setSelected(ids: string[]) {
  const cur = useCanvas.getState().selected;
  if (cur.length === ids.length && cur.every((id, i) => id === ids[i])) return;
  useCanvas.setState({ selected: ids });
}

export function setSelectMode(on: boolean) {
  useCanvas.setState(on ? { selectMode: true } : { selectMode: false, selected: [] });
  if (on) (document.activeElement as HTMLElement | null)?.blur?.();
}

export function resetCanvas() {
  useCanvas.setState({ selected: [], zoom: 1, activeEditor: null, selectMode: false });
}

/** Imperative helpers the mounted canvas provides (coordinates, focusing). */
export interface CanvasApi {
  /** A sensible spot for a new item of the given size inside the visible area. */
  visibleSpot(w: number, h: number): Point;
  worldPoint(clientX: number, clientY: number): Point;
  focusBlock(id: string): void;
  zoomTo(zoom: number, anchor?: Point): void;
}
export const canvasApi: { current: CanvasApi | null } = { current: null };

/** Live TipTap editors by block id, so new text boxes can be focused. */
export const editorRegistry = new Map<string, Editor>();
