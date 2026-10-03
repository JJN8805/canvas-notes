import type { Block } from '../types';

/**
 * Per-page undo/redo for canvas edits. Snapshots are the page's `blocks` array.
 * Because the store uses immer, unchanged blocks are shared between snapshots,
 * so keeping 200 steps is cheap.
 *
 * Typing in one box is coalesced into a single step (same `key`) until something
 * else happens, so one undo reverts one editing session rather than one keystroke.
 */
interface Stack {
  past: Block[][];
  future: Block[][];
  key: string | null;
  gesture: Block[] | null;
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
  record(pageId: string, before: Block[], key: string | null) {
    const s = stack(pageId);
    if (key && s.key === key) return;
    s.past.push(before);
    if (s.past.length > LIMIT) s.past.shift();
    s.future = [];
    s.key = key;
  },
  /** Start of a drag or resize: remember the layout before it. */
  beginGesture(pageId: string, current: Block[]) {
    stack(pageId).gesture = current;
  },
  /** End of a drag or resize: one undo step if anything changed. Returns true if a step was added. */
  endGesture(pageId: string, current: Block[]): boolean {
    const s = stack(pageId);
    const before = s.gesture;
    s.gesture = null;
    if (!before || before === current) return false;
    this.record(pageId, before, null);
    return true;
  },
  undo(pageId: string, current: Block[]): Block[] | null {
    const s = stack(pageId);
    const prev = s.past.pop();
    if (!prev) return null;
    s.future.push(current);
    s.key = null;
    return prev;
  },
  redo(pageId: string, current: Block[]): Block[] | null {
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
