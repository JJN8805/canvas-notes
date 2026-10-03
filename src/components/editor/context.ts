import { createContext, useContext } from 'react';
import type React from 'react';

export interface CanvasCtxValue {
  pageId: string;
  /** Start dragging a block (and the rest of the selection with it). */
  startMove(e: React.PointerEvent, blockId: string, opts?: { onTap?: () => void }): void;
  startResize(e: React.PointerEvent, blockId: string): void;
  /** Runs first on any pointer press inside a block: handles selection. */
  pointerDownBlock(e: React.PointerEvent, blockId: string): void;
  reportHeight(blockId: string, height: number): void;
}

export const CanvasCtx = createContext<CanvasCtxValue | null>(null);

export function useCanvasCtx(): CanvasCtxValue {
  const v = useContext(CanvasCtx);
  if (!v) throw new Error('Block rendered outside the canvas');
  return v;
}
