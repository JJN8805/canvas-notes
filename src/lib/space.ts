/**
 * The 3D page view's rules (pure). A box keeps its place on the page (x, y) and has a depth: how far toward you (positive) or away
 * (negative) it sits; the page itself is the plane at depth 0. **Unless a depth was chosen, it follows the page's own stacking**: a box
 * that lies behind another on the page is behind it in 3D too (each box that overlaps one below it rests on top of it). A chosen
 * depth, even 0, is kept as it is. Boxes are drawn as slabs with a thickness, so a square becomes a block. Notes are placed in 3D but written and edited flat, on the page: research on
 * 3D information displays (occlusion, awkward navigation, hard-to-read text in perspective) says to use depth for *where things are*, which
 * helps remembering, and not for typing. Nothing here touches the store: callers apply changes through `mutatePage`.
 */
import type { Block } from '../types';
import { blockHeight } from './util';
import { paintOrder } from './frames';
import type { P3 } from './tree3d';

export const DEPTH_MIN = -1200;
export const DEPTH_MAX = 1200;
export const DEPTH_STEP = 40;

/** A depth as a whole number inside the limits (anything that is not a number is 0). */
export const clampDepth = (d: unknown): number => (typeof d === 'number' && Number.isFinite(d) ? Math.max(DEPTH_MIN, Math.min(DEPTH_MAX, Math.round(d))) : 0);
/** The depth that was chosen for a box, or null when it follows the page's stacking. */
export const chosenDepth = (b: Pick<Block, 'depth'>): number | null => (typeof b.depth === 'number' && Number.isFinite(b.depth) ? clampDepth(b.depth) : null);

/** How thick a box is drawn: about half its smaller side (so a square comes out as a block, near a cube), within limits; a frame is only a thin backdrop. */
export const MIN_THICKNESS = 24;
export const MAX_THICKNESS = 90;
export const FRAME_THICKNESS = 4;
/** Air between a box and the one resting on it. */
export const LAYER_GAP = 8;
export const thicknessOf = (b: Pick<Block, 'type' | 'w' | 'h'>): number =>
  b.type === 'frame' ? FRAME_THICKNESS : Math.max(MIN_THICKNESS, Math.min(MAX_THICKNESS, Math.round(Math.min(b.w, b.h) * 0.5)));

/** Past this many boxes the stacking is not worked out (every box without a chosen depth stays on the page), so a huge page never stalls. */
const AUTO_LIMIT = 8000;
/** Boxes are filed in a grid of this many page pixels, so a box is only compared with the ones near it (not with every box below it). */
const CELL = 256;
/** A box that would cover more cells than this is kept in a short list that is always checked (a huge frame, a far-away box). */
const MAX_CELLS = 400;

const overlaps = (a: Block, b: Block): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + blockHeight(b) && b.y < a.y + blockHeight(a);

/**
 * The depth of every box: the chosen one, or else from the page's stacking. Going through the boxes from the bottom of the page to the
 * top, a box rests on the highest box beneath it that it overlaps (just above that box's front face, so blocks never run into each
 * other); a box overlapping nothing below it sits on the page (depth 0). A frame is the backdrop of what it holds, so its contents come
 * out in front of it. A chosen depth is used as it is, and boxes above it rest on it.
 */
export function effectiveDepths(blocks: readonly Block[]): Map<string, number> {
  const out = new Map<string, number>();
  const ordered = blocks.length <= AUTO_LIMIT ? paintOrder(blocks as Block[]) : [];
  type Placed = { b: Block; depth: number; at: number };
  const grid = new Map<string, Placed[]>();
  const wide: Placed[] = [];
  const range = (b: Block) => ({ x0: Math.floor(b.x / CELL), x1: Math.floor((b.x + b.w) / CELL), y0: Math.floor(b.y / CELL), y1: Math.floor((b.y + blockHeight(b)) / CELL) });
  let n = 0;
  for (const b of ordered) {
    const r = range(b);
    const cells = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    let d = 0;
    const seen = new Set<Placed>();
    const look = (o: Placed) => {
      if (seen.has(o)) return;
      seen.add(o);
      if (overlaps(b, o.b)) d = Math.max(d, o.depth + thicknessOf(o.b) + LAYER_GAP);
    };
    wide.forEach(look);
    if (cells <= MAX_CELLS) for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) grid.get(`${x},${y}`)?.forEach(look);
    else for (const list of grid.values()) list.forEach(look); // a huge box: look at everything placed so far
    const depth = chosenDepth(b) ?? clampDepth(d);
    out.set(b.id, depth);
    const placed: Placed = { b, depth, at: n++ };
    if (cells > MAX_CELLS) wide.push(placed);
    else for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) (grid.get(`${x},${y}`) ?? grid.set(`${x},${y}`, []).get(`${x},${y}`)!).push(placed);
  }
  for (const b of blocks) if (!out.has(b.id)) out.set(b.id, chosenDepth(b) ?? 0);
  return out;
}

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
export function boxCorners(b: Block, o: { x: number; y: number }, d: number): P3[] {
  const h = blockHeight(b);
  return [toWorld(b.x, b.y, d, o), toWorld(b.x + b.w, b.y, d, o), toWorld(b.x + b.w, b.y + h, d, o), toWorld(b.x, b.y + h, d, o)];
}

export const boxCentre = (b: Block, o: { x: number; y: number }, d: number): P3 => toWorld(b.x + b.w / 2, b.y + blockHeight(b) / 2, d, o);

/** A box as a block: its eight corners (the four of the front face, then the same four pushed back by the thickness). */
export const boxSolid = (b: Block, o: { x: number; y: number }, d: number): P3[] => {
  const front = boxCorners(b, o, d);
  const t = thicknessOf(b);
  return [...front, ...front.map((p) => ({ ...p, z: p.z + t }))];
};

export type FaceName = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';
/** The six faces of `boxSolid`: which corners, and which way each faces (x right, y up, z away from the viewer). */
export const FACES: readonly { name: FaceName; corners: [number, number, number, number]; normal: P3 }[] = [
  { name: 'back', corners: [4, 5, 6, 7], normal: { x: 0, y: 0, z: 1 } },
  { name: 'bottom', corners: [3, 2, 6, 7], normal: { x: 0, y: -1, z: 0 } },
  { name: 'top', corners: [0, 1, 5, 4], normal: { x: 0, y: 1, z: 0 } },
  { name: 'left', corners: [0, 3, 7, 4], normal: { x: -1, y: 0, z: 0 } },
  { name: 'right', corners: [1, 2, 6, 5], normal: { x: 1, y: 0, z: 0 } },
  { name: 'front', corners: [0, 1, 2, 3], normal: { x: 0, y: 0, z: -1 } },
];

/** The faces of a block the camera can see (the ones turned toward it), back faces left out. */
export function visibleFaces(solid: readonly P3[], eye: P3): (typeof FACES)[number][] {
  return FACES.filter((f) => {
    const c = f.corners.reduce((a, i) => ({ x: a.x + solid[i].x / 4, y: a.y + solid[i].y / 4, z: a.z + solid[i].z / 4 }), { x: 0, y: 0, z: 0 });
    return f.normal.x * (eye.x - c.x) + f.normal.y * (eye.y - c.y) + f.normal.z * (eye.z - c.z) > 0;
  });
}

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

/** Chooses the depth of the boxes with these ids (skipping frames and locked boxes); `null` hands it back to the page's stacking. Works on plain boxes and on store drafts. Returns how many changed. */
export function applyDepth(blocks: { id: string; type: string; locked?: boolean; depth?: number }[], ids: ReadonlySet<string> | readonly string[], depth: number | null): number {
  const want = new Set(ids);
  const d = depth === null ? null : clampDepth(depth);
  let n = 0;
  for (const b of blocks) {
    if (!want.has(b.id) || b.type === 'frame' || b.locked) continue;
    if (d === null) {
      if (b.depth === undefined) continue;
      delete b.depth;
    } else {
      if (b.depth === d) continue;
      b.depth = d;
    }
    n++;
  }
  return n;
}

/** Puts every box on the page itself (a chosen depth of 0, so it stays flat). */
export const flattenDepth = (blocks: { id: string; type: string; locked?: boolean; depth?: number }[]): number => applyDepth(blocks, blocks.map((b) => b.id), 0);

/** Hands every box back to the page's stacking: what is behind another box on the page is behind it in 3D. */
export const followStacking = (blocks: { id: string; type: string; locked?: boolean; depth?: number }[]): number => applyDepth(blocks, blocks.map((b) => b.id), null);

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
