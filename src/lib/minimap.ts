/**
 * The minimap (pure): where each box, and the part of the page you are looking at, sit in a small picture of the whole page.
 * Goodnotes, Miro and Figma all show one; people who work on big pages say getting lost is the main trouble.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MinimapLayout {
  scale: number;
  /** Canvas coordinate at the map's top-left. */
  ox: number;
  oy: number;
  /** Map size in pixels. */
  width: number;
  height: number;
  boxes: Box[];
  view: Box;
}

/** Fits every box and the view into a map at most `maxW` × `maxH`. Null when there is nothing to show. */
export function minimapLayout(boxes: Box[], view: Box, maxW = 168, maxH = 112, pad = 24): MinimapLayout | null {
  if (!boxes.length) return null;
  const all = [...boxes, view];
  const minX = Math.min(...all.map((b) => b.x)) - pad;
  const minY = Math.min(...all.map((b) => b.y)) - pad;
  const maxX = Math.max(...all.map((b) => b.x + b.w)) + pad;
  const maxY = Math.max(...all.map((b) => b.y + b.h)) + pad;
  const scale = Math.min(maxW / (maxX - minX), maxH / (maxY - minY));
  const to = (b: Box): Box => ({ x: (b.x - minX) * scale, y: (b.y - minY) * scale, w: Math.max(2, b.w * scale), h: Math.max(2, b.h * scale) });
  return { scale, ox: minX, oy: minY, width: (maxX - minX) * scale, height: (maxY - minY) * scale, boxes: boxes.map(to), view: to(view) };
}

/** True when the page is bigger than what the view shows, which is when a map earns its place. */
export function worthShowing(boxes: Box[], view: Box): boolean {
  return boxes.some((b) => b.x < view.x || b.y < view.y || b.x + b.w > view.x + view.w || b.y + b.h > view.y + view.h);
}

/** The canvas point under a spot on the map. */
export function mapToCanvas(l: MinimapLayout, px: number, py: number) {
  return { x: px / l.scale + l.ox, y: py / l.scale + l.oy };
}
