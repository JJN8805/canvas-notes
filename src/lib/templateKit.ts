import type { Arrow, Block, NoteColor } from '../types';

/** Shared helpers for laying out the built-in templates. */
export type Draft = { type: Block['type']; x: number; y: number; w: number; h: number } & Record<string, unknown>;

export function builder(prefix: string) {
  let n = 0;
  const id = () => `${prefix}-${++n}`;
  const blocks: Block[] = [];
  const add = (b: Draft) => {
    const full = { ...b, id: id(), z: blocks.length + 1 } as unknown as Block;
    if (full.frameId === undefined) delete full.frameId;
    blocks.push(full);
    return full.id;
  };
  return {
    blocks,
    id,
    add,
    text: (x: number, y: number, w: number, html: string, frameId?: string) => add({ type: 'text', x, y, w, h: 40, html, frameId } as Draft),
    list: (x: number, y: number, w: number, items: string[], frameId?: string) =>
      add({ type: 'checklist', x, y, w, h: 48, items: items.map((text, i) => ({ id: `${prefix}-item-${x}-${y}-${i}`, text, done: false })), frameId } as Draft),
    table: (x: number, y: number, w: number, rows: string[][], frameId?: string, h = 72) => add({ type: 'table', x, y, w, h, rows, frameId } as Draft),
    sticky: (x: number, y: number, tint: NoteColor, html: string, frameId?: string) =>
      add({ type: 'sticky', x, y, w: 200, h: 200, html, tint, frameId } as Draft),
    frame: (x: number, y: number, w: number, h: number, title: string, color: string, frameId?: string) =>
      add({ type: 'frame', x, y, w, h, title, color, collapsed: false, frameId } as Draft),
  };
}

export type Built = { title: string; blocks: Block[]; arrows: Arrow[] };

export const arrow = (id: string, from: string, to: string, label?: string): Arrow => ({ id, from, to, heads: 'one', style: 'solid', z: 1, ...(label ? { label } : {}) });
