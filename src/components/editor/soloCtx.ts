import type { CanvasCtxValue } from './context';

const noop = () => {};

/**
 * What a box needs from the canvas around it, for a box shown alone (a desktop widget, a card's details):
 * there is nothing to move, resize or connect, so those do nothing.
 */
export const soloCtx = (pageId: string): CanvasCtxValue => ({
  pageId,
  startMove: noop,
  startResize: noop,
  startConnect: noop,
  pointerDownBlock: noop,
  reportHeight: noop,
});
