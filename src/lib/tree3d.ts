/**
 * The library as a tree in three dimensions (pure): library → groups (nested) → pages → the headings inside each page. Each level sits one
 * step lower, and each branch gets its own wedge of the circle around the middle, sized by how many pages and headings it holds, so nothing
 * overlaps. A camera turns that into a flat picture: the picture is drawn with plain 2D canvas calls (no 3D library).
 */
import type { Group, Page } from '../types';
import { effectiveParents } from './groups';
import { outline } from './links';
import { pageApp, type OfficeApp } from './office/app';
import { isTemplate, kindOf } from './pages';

export type TKind = 'root' | 'group' | 'page' | 'card' | 'tag' | 'heading';

export interface TNode {
  id: string;
  label: string;
  kind: TKind;
  depth: number;
  children: TNode[];
  /** For a page, or a heading (the page it is in). */
  pageId?: string;
  /** For a heading: the box it is in. */
  blockId?: string;
  /** For a group: its colour name. */
  color?: string;
  /** For a page: a Workspace page's kind. */
  app?: OfficeApp | null;
  /** Links in and out (pages, cards, tags), which sizes the dot. */
  links?: number;
  /** Pages and headings below this node (a leaf counts one), which sizes its wedge. */
  weight: number;
}

export interface TreeOptions {
  /** Show each page's headings under it. */
  headings: boolean;
  /** Most headings kept per page, and most nodes in all (a huge library is cut, never frozen). */
  maxHeadings?: number;
  maxNodes?: number;
}

export const DEFAULT_TREE_OPTIONS: TreeOptions = { headings: true, maxHeadings: 24, maxNodes: 4000 };

const byLabel = (a: TNode, b: TNode) => a.label.localeCompare(b.label);

export function buildTree(pages: Record<string, Page>, groups: Group[], o: TreeOptions = DEFAULT_TREE_OPTIONS): TNode {
  const maxNodes = o.maxNodes ?? 4000;
  let made = 1;
  const root: TNode = { id: 'root', label: 'Library', kind: 'root', depth: 0, children: [], weight: 1 };
  const parents = effectiveParents(groups);
  const groupNode = new Map<string, TNode>();
  for (const g of groups.filter((x) => x.scope !== 'cards')) groupNode.set(g.id, { id: `g:${g.id}`, label: g.name || 'Untitled group', kind: 'group', depth: 0, children: [], color: g.color, weight: 1 });
  for (const g of groups) {
    const n = groupNode.get(g.id);
    if (!n) continue;
    const p = parents.get(g.id);
    (p && groupNode.get(p) ? groupNode.get(p)! : root).children.push(n);
    made++;
  }
  const list = Object.values(pages).filter((p) => kindOf(p) === 'page' && !isTemplate(p) && !p.dailyDate).sort((a, b) => b.updated - a.updated);
  for (const p of list) {
    if (made >= maxNodes) break;
    const node: TNode = { id: `p:${p.id}`, label: p.title.trim() || 'Untitled', kind: 'page', depth: 0, children: [], pageId: p.id, app: pageApp(p), weight: 1 };
    made++;
    if (o.headings) {
      // Headings nest by level: an H2 goes under the H1 before it, and so on.
      const stack: { level: number; node: TNode }[] = [];
      let count = 0;
      for (const h of outline(p)) {
        if (count >= (o.maxHeadings ?? 24) || made >= maxNodes) break;
        const hn: TNode = { id: `h:${p.id}:${h.blockId}:${count}`, label: h.text.slice(0, 60), kind: 'heading', depth: 0, children: [], pageId: p.id, blockId: h.blockId, weight: 1 };
        while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
        (stack.length ? stack[stack.length - 1].node : node).children.push(hn);
        stack.push({ level: h.level, node: hn });
        count++;
        made++;
      }
    }
    const gid = p.groupId && groupNode.has(p.groupId) ? p.groupId : null;
    (gid ? groupNode.get(gid)! : root).children.push(node);
  }
  finishTree(root);
  return root;
}

/** Depth and weight, then each node's children in a steady order: groups first, then pages and headings by name. Run again after changing a tree. */
export function finishTree(root: TNode): void {
  const finish = (n: TNode, depth: number): number => {
    n.depth = depth;
    n.children.sort((a, b) => (a.kind === b.kind ? byLabel(a, b) : a.kind === 'group' ? -1 : b.kind === 'group' ? 1 : 0));
    n.weight = n.children.length ? n.children.reduce((s, c) => s + finish(c, depth + 1), 0) : 1;
    return n.weight;
  };
  finish(root, 0);
}

export const flatten = (n: TNode): TNode[] => [n, ...n.children.flatMap(flatten)];

/** Nodes with their ancestors' branches closed left out: a closed node is drawn but its descendants are not. */
export function visible(root: TNode, closed: ReadonlySet<string>): TNode[] {
  const out: TNode[] = [];
  const walk = (n: TNode) => {
    out.push(n);
    if (!closed.has(n.id)) n.children.forEach(walk);
  };
  walk(root);
  return out;
}

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export interface LayoutOptions {
  /** Distance between levels, and between rings. */
  levelGap: number;
  ringGap: number;
}
export const DEFAULT_LAYOUT: LayoutOptions = { levelGap: 120, ringGap: 150 };

/**
 * Where each node goes. Level = height (the library at the top); distance from the middle grows with depth; the angle comes from a
 * wedge of the circle shared out by weight, so a branch with many pages is wide and its children stay inside it.
 */
export function coneLayout(root: TNode, closed: ReadonlySet<string> = new Set(), o: LayoutOptions = DEFAULT_LAYOUT): Map<string, P3> {
  const pos = new Map<string, P3>();
  const weightOf = (n: TNode): number => (closed.has(n.id) || !n.children.length ? 1 : n.children.reduce((s, c) => s + weightOf(c), 0));
  const place = (n: TNode, a0: number, a1: number) => {
    const mid = (a0 + a1) / 2;
    const r = n.depth === 0 ? 0 : o.ringGap * (0.55 + 0.45 * n.depth) + o.ringGap * 0.35 * Math.sqrt(n.depth);
    pos.set(n.id, { x: Math.cos(mid) * r + 0, y: -n.depth * o.levelGap + 0, z: Math.sin(mid) * r + 0 }); // + 0 turns -0 into 0
    if (closed.has(n.id) || !n.children.length) return;
    const total = n.children.reduce((s, c) => s + weightOf(c), 0);
    let a = a0;
    for (const c of n.children) {
      const span = ((a1 - a0) * weightOf(c)) / total;
      place(c, a, a + span);
      a += span;
    }
  };
  place(root, 0, Math.PI * 2);
  return pos;
}

/* ---------------- the camera ---------------- */

export interface Camera {
  /** Turn around the vertical axis, and tilt, in radians. */
  yaw: number;
  pitch: number;
  /** Distance from the middle of the picture. */
  dist: number;
  /** Where the picture's middle is looked at. */
  target: P3;
}

export const DEFAULT_CAMERA: Camera = { yaw: 0.6, pitch: 0.35, dist: 900, target: { x: 0, y: -120, z: 0 } };
export const FOV = 700; // focal length in pixels: how strongly distance shrinks things
export const clampPitch = (p: number) => Math.max(-1.45, Math.min(1.45, p));
export const clampDist = (d: number) => Math.max(120, Math.min(6000, d));

export interface Projected {
  x: number;
  y: number;
  /** Distance in front of the camera: smaller is nearer (draw far things first). */
  depth: number;
  /** How big things look here (1 = at the focal distance). */
  scale: number;
}

/** A point on the screen (null when it is behind the camera). */
export function project(p: P3, c: Camera, w: number, h: number): Projected | null {
  const x0 = p.x - c.target.x;
  const y0 = p.y - c.target.y;
  const z0 = p.z - c.target.z;
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  const x1 = x0 * cy - z0 * sy; // turn around the vertical axis
  const z1 = x0 * sy + z0 * cy;
  const cp = Math.cos(c.pitch);
  const sp = Math.sin(c.pitch);
  const y2 = y0 * cp - z1 * sp; // tilt
  const z2 = y0 * sp + z1 * cp;
  const depth = c.dist + z2;
  if (depth < 20) return null;
  const scale = FOV / depth;
  return { x: w / 2 + x1 * scale, y: h / 2 - y2 * scale, depth, scale };
}

/** The nearest drawn node within `reach` pixels of a point, or null. Nodes nearer the camera win ties. */
export function pick(items: readonly { id: string; at: Projected; r: number }[], px: number, py: number, reach = 6): string | null {
  let best: { id: string; d: number; depth: number } | null = null;
  for (const it of items) {
    const d = Math.hypot(it.at.x - px, it.at.y - py);
    if (d > it.r + reach) continue;
    if (!best || it.at.depth < best.depth - 0.001 || (Math.abs(it.at.depth - best.depth) <= 0.001 && d < best.d)) best = { id: it.id, d, depth: it.at.depth };
  }
  return best?.id ?? null;
}

/** A camera that looks at a node, keeping its angle and distance. */
export const lookAt = (c: Camera, p: P3): Camera => ({ ...c, target: { ...p } });

/** A camera far enough back to see every position. */
export function frame(positions: Iterable<P3>, c: Camera = DEFAULT_CAMERA, margin = 3.1): Camera {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity, any = false;
  for (const p of positions) {
    any = true;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  if (!any) return c;
  const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 80;
  return { ...c, target: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 }, dist: clampDist(radius * margin) };
}

/** The point in space at a screen position and a distance in front of the camera (the opposite of `project`): used to drag a node. */
export function unproject(screenX: number, screenY: number, depth: number, c: Camera, w: number, h: number): P3 {
  const scale = FOV / depth;
  const x1 = (screenX - w / 2) / scale;
  const y2 = (h / 2 - screenY) / scale;
  const z2 = depth - c.dist;
  const cp = Math.cos(c.pitch);
  const sp = Math.sin(c.pitch);
  const y0 = y2 * cp + z2 * sp;
  const z1 = -y2 * sp + z2 * cp;
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  return { x: x1 * cy + z1 * sy + c.target.x, y: y0 + c.target.y, z: -x1 * sy + z1 * cy + c.target.z };
}

/** How far a point is from a line segment, in pixels (to tell which line the pointer is on). */
export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** A camera moved a fraction of the way to another (for a smooth fit). */
export const easeCamera = (from: Camera, to: Camera, k: number): Camera => ({
  ...from,
  dist: from.dist + (to.dist - from.dist) * k,
  target: { x: from.target.x + (to.target.x - from.target.x) * k, y: from.target.y + (to.target.y - from.target.y) * k, z: from.target.z + (to.target.z - from.target.z) * k },
});

/** Where the camera is in the picture's coordinates (to tell which faces of a block face it). */
export function cameraPosition(c: Camera): P3 {
  const cp = Math.cos(c.pitch);
  const sp = Math.sin(c.pitch);
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  return { x: c.target.x - c.dist * cp * sy, y: c.target.y - c.dist * sp, z: c.target.z - c.dist * cp * cy };
}
