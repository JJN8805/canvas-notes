import type { Arrow, Block } from '../types';

/**
 * Per-page undo/redo for canvas edits. Snapshots are the page's `blocks` and
 * `arrows` arrays together, so a box delete and the arrows it took with it
 * undo as one step. Because the store uses immer, unchanged arrays are shared
 * between snapshots, so keeping 200 steps is cheap.
 *
 * Typing in one box is coalesced into a single step (same `key`) until something
 * else happens, so one undo reverts one editing session rather than one keystroke.
 */
export interface Snapshot {
  blocks: Block[];
  arrows: Arrow[];
}

interface Stack {
  past: Snapshot[];
  future: Snapshot[];
  key: string | null;
  gesture: Snapshot | null;
}

const LIMIT = 200;
const stacks = new Map<string, Stack>();

function stack(pageId: string): Stack {
  let s = stacks.get(pageId);
  if (!s) {
    s = { past: [], future: [], key: null, gesture: null };
    stacks.set(pageId, s);
  }
  return s;
}

export const history = {
  record(pageId: string, before: Snapshot, key: string | null) {
    const s = stack(pageId);
    if (key && s.key === key) return;
    s.past.push(before);
    if (s.past.length > LIMIT) s.past.shift();
    s.future = [];
    s.key = key;
  },
  /** Start of a drag or resize: remember the layout before it. */
  beginGesture(pageId: string, current: Snapshot) {
    stack(pageId).gesture = current;
  },
  /** End of a drag or resize: one undo step if anything changed. Returns true if a step was added. */
  endGesture(pageId: string, current: Snapshot): boolean {
    const s = stack(pageId);
    const before = s.gesture;
    s.gesture = null;
    if (!before || (before.blocks === current.blocks && before.arrows === current.arrows)) return false;
    this.record(pageId, before, null);
    return true;
  },
  undo(pageId: string, current: Snapshot): Snapshot | null {
    const s = stack(pageId);
    const prev = s.past.pop();
    if (!prev) return null;
    s.future.push(current);
    s.key = null;
    return prev;
  },
  redo(pageId: string, current: Snapshot): Snapshot | null {
    const s = stack(pageId);
    const next = s.future.pop();
    if (!next) return null;
    s.past.push(current);
    s.key = null;
    return next;
  },
  canUndo: (pageId: string) => (stacks.get(pageId)?.past.length ?? 0) > 0,
  canRedo: (pageId: string) => (stacks.get(pageId)?.future.length ?? 0) > 0,
  clear(pageId: string) {
    stacks.delete(pageId);
  },
};
