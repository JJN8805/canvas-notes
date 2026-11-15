/**
 * What is painted over what. Pure code (no app state), so it is tested without the app.
 *
 * Boxes keep their own order (`z`, with frames behind the boxes beside them). The page's drawing is one more layer: by default it is
 * painted over every box; a box can be marked `over` to be painted over the drawing instead, and the whole drawing can be put `behind`
 * every box. A frame's contents follow the frame, so only a top-level box's mark counts.
 */
import type { Block } from '../types';
import { effectiveFrameParents } from './frames';

/** Each box's top-level ancestor (itself when it is not inside a frame). */
export function topLevelOf(blocks: readonly Block[]): Map<string, string> {
  const parents = effectiveFrameParents(blocks as Block[]);
  const out = new Map<string, string>();
  for (const b of blocks) {
    let id = b.id;
    for (let n = 0; n < blocks.length + 1; n++) {
      const p = parents.get(id);
      if (!p) break;
      id = p;
    }
    out.set(b.id, id);
  }
  return out;
}

/** The boxes in paint order, split into those painted under the drawing and those painted over it (each part keeps its order). */
export function splitByDrawing(ordered: readonly Block[], all: readonly Block[]): { below: Block[]; above: Block[] } {
  const top = topLevelOf(all);
  const byId = new Map(all.map((b) => [b.id, b]));
  const below: Block[] = [];
  const above: Block[] = [];
  for (const b of ordered) (byId.get(top.get(b.id) ?? b.id)?.over ? above : below).push(b);
  return { below, above };
}

export type Step = 'forward' | 'backward';

/**
 * Moves the chosen boxes one place forward or backward among the boxes they are stacked with (the same frame, frames kept behind
 * plain boxes). Returns the new `z` of every box that changes; empty when there is nothing to do (already at that end).
 */
export function stepOrder(blocks: readonly Block[], ids: readonly string[], dir: Step): Map<string, number> {
  const parents = effectiveFrameParents(blocks as Block[]);
  const chosen = new Set(ids);
  const changes = new Map<string, number>();
  // Boxes are stacked with their siblings; a frame and a plain box are stacked apart (frames always sit behind).
  const lists = new Map<string, Block[]>();
  for (const b of blocks) {
    const key = `${parents.get(b.id) ?? ''}|${b.type === 'frame' ? 'f' : 'b'}`;
    (lists.get(key) ?? lists.set(key, []).get(key)!).push(b);
  }
  for (const list of lists.values()) {
    if (!list.some((b) => chosen.has(b.id))) continue;
    // Bottom to top, ties kept in the order the boxes are stored in.
    const order = list.map((b, i) => ({ b, i })).sort((a, c) => (a.b.z || 0) - (c.b.z || 0) || a.i - c.i).map((x) => x.b);
    const before = order.map((b) => b.id).join();
    if (dir === 'forward') {
      for (let i = order.length - 2; i >= 0; i--) if (chosen.has(order[i].id) && !chosen.has(order[i + 1].id)) [order[i], order[i + 1]] = [order[i + 1], order[i]];
    } else {
      for (let i = 1; i < order.length; i++) if (chosen.has(order[i].id) && !chosen.has(order[i - 1].id)) [order[i], order[i - 1]] = [order[i - 1], order[i]];
    }
    if (order.map((b) => b.id).join() === before) continue;
    order.forEach((b, i) => {
      if ((b.z || 0) !== i + 1) changes.set(b.id, i + 1);
    });
  }
  return changes;
}

/** The ids whose "over the drawing" mark counts for the given boxes: their top-level ancestors, without repeats. */
export function markTargets(blocks: readonly Block[], ids: readonly string[]): string[] {
  const top = topLevelOf(blocks);
  return [...new Set(ids.map((id) => top.get(id)).filter((x): x is string => !!x))];
}
