/** A copy of the list with the item at `from` moved so it ends up at index `to` (both clamped to the list). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = items.slice();
  if (from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it);
  return out;
}

/**
 * Where a dragged row lands: the position, among the other rows, of the pointer.
 * `mids` are the vertical centres of all rows in their current order (the dragged one included).
 */
export function dropIndex(mids: readonly number[], from: number, pointerY: number): number {
  let to = 0;
  for (let i = 0; i < mids.length; i++) {
    if (i === from) continue;
    if (pointerY > mids[i]) to++;
  }
  return to;
}
