import type { Block } from '../types';

/** The ids among `ids` whose boxes are free to move, resize or delete (not locked). Ids that match no box are dropped. */
export function freeIds(blocks: Block[], ids: string[]): string[] {
  const locked = new Set(blocks.filter((b) => b.locked).map((b) => b.id));
  const known = new Set(blocks.map((b) => b.id));
  return ids.filter((id) => known.has(id) && !locked.has(id));
}

/** True when every one of these boxes is locked (so the menu offers "Unlock"). */
export function allLocked(blocks: Block[], ids: string[]): boolean {
  const picked = blocks.filter((b) => ids.includes(b.id));
  return picked.length > 0 && picked.every((b) => b.locked);
}
