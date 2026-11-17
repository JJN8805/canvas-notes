/**
 * The 3D page view's rules (pure). A box keeps its place on the page (x, y) and gains a depth: how far toward you (positive) or away
 * (negative) it sits. The page itself is the plane at depth 0. Notes are placed in 3D but written and edited flat, on the page: research on
 * 3D information displays (occlusion, awkward navigation, hard-to-read text in perspective) says to use depth for *where things are*, which
 * helps remembering, and not for typing. Nothing here touches the store: callers apply changes through `mutatePage`.
 */
import type { Block } from '../types';
import { blockHeight } from './util';
import type { P3 } from './tree3d';

export const DEPTH_MIN = -1200;
export const DEPTH_MAX = 1200;
export const DEPTH_STEP = 40;

/** A depth as a whole number inside the limits (anything that is not a number is 0). */
export const clampDepth = (d: unknown): number => (typeof d === 'number' && Number.isFinite(d) ? Math.max(DEPTH_MIN, Math.min(DEPTH_MAX, Math.round(d))) : 0);
export const depthOf = (b: Pick<Block, 'depth'>): number => clampDepth(b.depth);

/** A frame holds other boxes and moves with them on the page, so the 3D view only shows it (it is not moved or layered on its own). */
export const isLayerable = (b: Pick<Block, 'type' | 'locked'>): boolean => b.type !== 'frame' && !b.locked;

/** The middle of the boxes on the page (page coordinates): the point the 3D picture is centred on. */
export function pageCentre(blocks: readonly Block[]): { x: number; y: number } {
  if (!blocks.length) return { x: 0, y: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of blocks) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + blockHeight(b));
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** World coordinates: x to the right, y UP (the page's y runs down), and z AWAY from the viewer, so more depth = nearer = smaller z. */
export const toWorld = (px: number, py: number, depth: number, o: { x: number; y: number }): P3 => ({ x: px - o.x, y: -(py - o.y), z: -depth });
export const toPage = (wx: number, wy: number, o: { x: number; y: number }) => ({ x: wx + o.x, y: o.y - wy });

/** The four corners of a box in the picture (top-left, top-right, bottom-right, bottom-left). */
export function boxCorners(b: Block, o: { x: number; y: number }): P3[] {
  const d = depthOf(b);
  const h = blockHeight(b);
  return [toWorld(b.x, b.y, d, o), toWorld(b.x + b.w, b.y, d, o), toWorld(b.x + b.w, b.y + h, d, o), toWorld(b.x, b.y + h, d, o)];
}

export const boxCentre = (b: Block, o: { x: number; y: number }): P3 => toWorld(b.x + b.w / 2, b.y + blockHeight(b) / 2, depthOf(b), o);

/** Whether a point is inside a polygon (the box's four projected corners). */
export function pointInQuad(px: number, py: number, q: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const a = q[i];
    const b = q[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Where a line through two points crosses the plane z = `z` (null when the line runs along the plane): turns a pointer position into a place on a box's layer. */
export function rayPlaneZ(p1: P3, p2: P3, z: number): P3 | null {
  const dz = p2.z - p1.z;
  if (Math.abs(dz) < 1e-9) return null;
  const t = (z - p1.z) / dz;
  return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t, z };
}

/** Sets the depth of the boxes with these ids (skipping frames and locked boxes). Works on plain boxes and on store drafts. Returns how many changed. */
export function applyDepth(blocks: { id: string; type: string; locked?: boolean; depth?: number }[], ids: ReadonlySet<string> | readonly string[], depth: number): number {
  const want = new Set(ids);
  const d = clampDepth(depth);
  let n = 0;
  for (const b of blocks) {
    if (!want.has(b.id) || b.type === 'frame' || b.locked) continue;
    if ((b.depth ?? 0) === d) continue;
    if (d === 0) delete b.depth;
    else b.depth = d;
    n++;
  }
  return n;
}

/** Spreads the boxes out in depth by their stacking order, so boxes lying on top of each other come apart: the one on top comes forward. Centred on the page. */
export function fanOut(blocks: { id: string; type: string; locked?: boolean; z: number; depth?: number }[], gap = DEPTH_STEP): number {
  const layers = blocks.filter((b) => b.type !== 'frame' && !b.locked).sort((a, b) => a.z - b.z);
  let n = 0;
  layers.forEach((b, i) => {
    const d = clampDepth(Math.round((i - (layers.length - 1) / 2) * gap));
    if ((b.depth ?? 0) === d) return;
    if (d === 0) delete b.depth;
    else b.depth = d;
    n++;
  });
  return n;
}

/** Puts every box back on the page itself. */
export const flattenDepth = (blocks: { id: string; type: string; locked?: boolean; depth?: number }[]): number => applyDepth(blocks, blocks.map((b) => b.id), 0);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** The words in a box for drawing on a card in the picture (plain text; the picture is drawn with canvas text, never as HTML). */
export function snippet(b: Block, max = 200): string {
  let raw = '';
  switch (b.type) {
    case 'note': raw = b.style === 'code' ? (b.code ?? '') : (b.html ?? '').replace(/<\/(p|div|h[1-6]|li|br)>|<br\s*\/?>/gi, '\n'); break;
    case 'checklist': raw = b.items.map((i) => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n'); break;
    case 'table': raw = b.rows.map((r) => r.join(' · ')).join('\n'); break;
    case 'frame': raw = b.title; break;
    case 'image': raw = 'Picture'; break;
    case 'audio': raw = b.name || 'Audio'; break;
    case 'pdf': raw = b.name || 'PDF'; break;
    default: raw = '';
  }
  const plain = raw.replace(/<[^>]*>/g, '').replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m);
  const lines = plain.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  return lines.length > max ? lines.slice(0, max - 1) + '…' : lines;
}
