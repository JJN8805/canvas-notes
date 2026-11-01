/**
 * Containment logic for frames: a labelled rectangle that holds other blocks
 * (including other frames, since frames can nest). Blocks point at their
 * container via `frameId`; these are the tree algorithms over that pointer,
 * mirroring lib/groups.ts's parentId tree.
 */
import type { Block, FrameBlock } from '../types';
import type { Rect } from './guides';

function isFrame(b: Block): b is FrameBlock {
  return b.type === 'frame';
}

/**
 * The frameId each block is actually shown under. A frameId pointing at a
 * block that no longer exists, or at a non-frame block, counts as "no
 * parent". If frames form a loop (possible when two devices nest frames into
 * each other before syncing), the loop member that comes first in the list
 * is lifted to the top level, mirroring groups.ts's effectiveParents.
 */
export function effectiveFrameParents(blocks: Block[]): Map<string, string | null> {
  const frameIds = new Set(blocks.filter(isFrame).map((b) => b.id));
  const parent = new Map<string, string | null>(
    blocks.map((b) => [b.id, b.frameId && frameIds.has(b.frameId) ? b.frameId : null])
  );
  for (const b of blocks) {
    const seen = new Set<string>();
    let cur = parent.get(b.id) ?? null;
    while (cur) {
      if (cur === b.id) {
        parent.set(b.id, null);
        break;
      }
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = parent.get(cur) ?? null;
    }
  }
  return parent;
}

/** The frame and everything nested inside it, direct and indirect. */
export function frameDescendants(blocks: Block[], id: string): Set<string> {
  const parents = effectiveFrameParents(blocks);
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of blocks) {
      const p = parents.get(b.id);
      if (p && out.has(p) && !out.has(b.id)) {
        out.add(b.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Frames `id` may be moved into: any frame except itself and its own descendants. */
export function validFrameTargets(blocks: Block[], id: string): FrameBlock[] {
  const blocked = frameDescendants(blocks, id);
  return blocks.filter(isFrame).filter((b) => !blocked.has(b.id));
}

/**
 * Which frame (if any) a rect's centre point falls inside, picking the
 * smallest-area (innermost) match when frames overlap. `excludeIds` keeps a
 * moved frame from being dropped into itself or one of its own descendants.
 */
export function containingFrame(blocks: Block[], rect: Rect, excludeIds: ReadonlySet<string>): FrameBlock | null {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let best: FrameBlock | null = null;
  let bestArea = Infinity;
  for (const b of blocks) {
    if (!isFrame(b) || excludeIds.has(b.id)) continue;
    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
      const area = b.w * b.h;
      if (area < bestArea) {
        best = b;
        bestArea = area;
      }
    }
  }
  return best;
}

/** Ids invisible because some ancestor frame is collapsed. */
export function hiddenBlockIds(blocks: Block[]): Set<string> {
  const parents = effectiveFrameParents(blocks);
  const collapsedFrames = new Set(blocks.filter(isFrame).filter((b) => b.collapsed).map((b) => b.id));
  const hidden = new Set<string>();
  for (const b of blocks) {
    const seen = new Set<string>();
    let cur = parents.get(b.id) ?? null;
    while (cur && !seen.has(cur)) {
      if (collapsedFrames.has(cur)) {
        hidden.add(b.id);
        break;
      }
      seen.add(cur);
      cur = parents.get(cur) ?? null;
    }
  }
  return hidden;
}

/**
 * Pre-order traversal of the containment forest: a frame is immediately
 * followed by its own contents (recursively), so a parent always paints
 * behind everything nested inside it. Within one parent, frame siblings
 * always paint behind non-frame siblings (so a nested frame still sits
 * behind its own siblings' boxes); ties are broken by `z`.
 */
export function paintOrder(blocks: Block[]): Block[] {
  const parents = effectiveFrameParents(blocks);
  const children = new Map<string | null, Block[]>();
  for (const b of blocks) {
    const p = parents.get(b.id) ?? null;
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(b);
  }
  const rank = (b: Block) => (isFrame(b) ? 0 : 1);
  for (const list of children.values()) list.sort((a, c) => rank(a) - rank(c) || a.z - c.z);
  const out: Block[] = [];
  const walk = (parent: string | null) => {
    for (const b of children.get(parent) ?? []) {
      out.push(b);
      if (isFrame(b)) walk(b.id);
    }
  };
  walk(null);
  return out;
}

/**
 * Blocks whose frameId points (directly or transitively) at a block that's
 * being deleted get reparented to the nearest surviving ancestor frame (or
 * top level) — so deleting a frame ungroups its contents instead of leaving
 * them pointed at a dead id. Returns only the ids that need updating.
 */
export function ungroupedAfterDelete(blocks: Block[], deletedIds: ReadonlySet<string>): Map<string, string | null> {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const resolve = (id: string | null | undefined, seen: Set<string> = new Set()): string | null => {
    if (!id || !byId.has(id) || seen.has(id)) return null;
    if (!deletedIds.has(id)) return id;
    seen.add(id);
    return resolve(byId.get(id)!.frameId, seen);
  };
  const out = new Map<string, string | null>();
  for (const b of blocks) {
    if (deletedIds.has(b.id)) continue;
    if (b.frameId && deletedIds.has(b.frameId)) out.set(b.id, resolve(b.frameId));
  }
  return out;
}
