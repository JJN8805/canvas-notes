/**
 * Maths for the infinite canvas. The browser can only scroll from 0 rightwards and downwards, so the page
 * keeps an *origin*: the canvas coordinate shown at scroll position 0. Boxes keep their real (possibly negative)
 * coordinates; the origin moves left and up as you go that way, and the scroll position is shifted to match so nothing jumps.
 */

export interface Pt {
  x: number;
  y: number;
}
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Screen pixels of empty canvas that must remain between the view and the edge of the scrollable area. */
export const EDGE_PX = 800;
/** How far (screen pixels) the area grows each time the view gets that close to its top or left edge. */
export const STEP_PX = 1600;
/** Origins are kept on a coarse grid so they change rarely while a box is being dragged. */
const GRID = 256;

/** The box around everything on the page, or null for an empty page. */
export function contentBounds(boxes: { x: number; y: number; w: number; h: number }[]): Bounds | null {
  if (!boxes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { minX, minY, maxX, maxY };
}

/** The origin a page starts with: room before the top-left of the canvas (or of the content, if it reaches further). */
export function initialOrigin(content: Bounds | null, zoom: number): Pt {
  const room = Math.ceil((EDGE_PX + STEP_PX) / zoom);
  return { x: Math.min(0, content?.minX ?? 0) - room, y: Math.min(0, content?.minY ?? 0) - room };
}

/**
 * Moves one axis of the origin further out when content (or the view) is within EDGE_PX of it. The origin never moves back,
 * so scrolling and dragging stay stable. Returns the same number when nothing needs to change.
 */
export function growOrigin(origin: number, contentMin: number | null, scroll: number, zoom: number): number {
  let next = origin;
  const room = Math.ceil((EDGE_PX + STEP_PX) / zoom);
  if (contentMin !== null && contentMin - next < EDGE_PX / zoom) {
    next = Math.min(next, Math.floor((contentMin - room) / GRID) * GRID);
  }
  if (scroll < EDGE_PX) next -= Math.ceil(STEP_PX / zoom);
  return next;
}

/** How far to shift the scroll position when the origin moves, so the same part of the canvas stays in view. */
export const scrollShift = (oldOrigin: number, newOrigin: number, zoom: number) => (oldOrigin - newOrigin) * zoom;

/** Canvas coordinate under a point `offset` screen pixels into the scrolled view. */
export const toCanvas = (offset: number, scroll: number, origin: number, zoom: number) => (offset + scroll) / zoom + origin;

/** Where (and how big) to put the view so `content` fits in a viewport of vw × vh screen pixels, centred. */
export function fitView(content: Bounds, vw: number, vh: number, minZoom: number, maxZoom = 1, pad = 48) {
  const w = content.maxX - content.minX;
  const h = content.maxY - content.minY;
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min((vw - pad * 2) / Math.max(w, 1), (vh - pad * 2) / Math.max(h, 1))));
  return {
    zoom,
    /** Canvas coordinate of the viewport's left and top edges. */
    x: content.minX - (vw / zoom - w) / 2,
    y: content.minY - (vh / zoom - h) / 2,
  };
}
