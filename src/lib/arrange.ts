/**
 * Align and distribute (pure). The same commands and letters Figma, Miro and FigJam use:
 * Alt+A/D/W/S line boxes up on their left, right, top, bottom edge; Alt+H/V centre them; Alt+Shift+H/V spread them evenly.
 */
export interface Item {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y';
export type DistributeAxis = 'x' | 'y';

/** New positions for the boxes that must move. Needs two boxes or more; an empty map means "already so". */
export function alignItems(items: Item[], mode: AlignMode): Map<string, { x?: number; y?: number }> {
  const out = new Map<string, { x?: number; y?: number }>();
  if (items.length < 2) return out;
  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.w));
  const minY = Math.min(...items.map((i) => i.y));
  const maxY = Math.max(...items.map((i) => i.y + i.h));
  for (const i of items) {
    let x: number | undefined;
    let y: number | undefined;
    if (mode === 'left') x = minX;
    else if (mode === 'right') x = maxX - i.w;
    else if (mode === 'center-x') x = Math.round((minX + maxX) / 2 - i.w / 2);
    else if (mode === 'top') y = minY;
    else if (mode === 'bottom') y = maxY - i.h;
    else y = Math.round((minY + maxY) / 2 - i.h / 2);
    if ((x !== undefined && x !== i.x) || (y !== undefined && y !== i.y)) out.set(i.id, { x, y });
  }
  return out;
}

/** Equal gaps between boxes along one axis, the outermost two staying where they are. Needs three boxes or more. */
export function distributeItems(items: Item[], axis: DistributeAxis): Map<string, { x?: number; y?: number }> {
  const out = new Map<string, { x?: number; y?: number }>();
  if (items.length < 3) return out;
  const pos = (i: Item) => (axis === 'x' ? i.x : i.y);
  const size = (i: Item) => (axis === 'x' ? i.w : i.h);
  const sorted = [...items].sort((a, b) => pos(a) - pos(b) || a.id.localeCompare(b.id));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - sorted.reduce((s, i) => s + size(i), 0)) / (sorted.length - 1);
  let at = pos(first) + size(first) + gap;
  for (const i of sorted.slice(1, -1)) {
    const p = Math.round(at);
    if (p !== pos(i)) out.set(i.id, axis === 'x' ? { x: p } : { y: p });
    at += size(i) + gap;
  }
  return out;
}
