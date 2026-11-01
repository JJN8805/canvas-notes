import type { PageDrawing } from '../types';

/** An SVG string as an image source. Shown through <img>, so scripts inside it can never run. */
export const svgSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The drawing, or null when the page has none worth keeping (nothing drawn, or a damaged copy). */
export const liveDrawing = (d: PageDrawing | null | undefined): PageDrawing | null => (d && d.preview && d.w > 0 && d.h > 0 ? d : null);

/** The area of the canvas a set of boxes and the drawing cover together. */
export function unionBounds(boxes: { x: number; y: number; w: number; h: number }[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Excalidraw falls back to its pointer tool after every stroke unless the tool is locked. Given the tool seen last time and
 * the active one now, returns the tool to lock (a newly picked drawing tool), or null to leave things alone — including when
 * you have unlocked the same tool yourself.
 */
export function toolToLock(last: string, now: { type: string; locked?: boolean }): string | null {
  if (now.type === last) return null;
  return now.type !== 'selection' && now.type !== 'custom' && !now.locked ? now.type : null;
}
