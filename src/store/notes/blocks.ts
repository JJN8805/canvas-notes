import { Block, BlockType } from '../../types';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE } from '../../lib/colors';
import { usePrefs } from '../prefs';
import { deepClone, newId } from '../../lib/util';
import { containingFrame, ungroupedAfterDelete } from '../../lib/frames';
import type { Draft } from 'immer';
import { get } from './state';
import { mutatePage } from './mutate';

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

/** Height of an audio player box: its name above the player. */
export const AUDIO_H = 88;

export type NewBlockFields = Partial<Omit<Block, 'id' | 'type'>> & Record<string, unknown>;

export const BLOCK_DEFAULTS: Record<Exclude<BlockType, 'image'>, () => NewBlockFields> = {
  text: () => ({ w: 280, h: 40, html: '' }),
  checklist: () => ({ w: 288, h: 48, items: [{ id: newId(), text: '', done: false }] }),
  code: () => ({ w: 432, h: 72, code: '' }),
  table: () => ({
    w: 384,
    h: 72,
    rows: [
      ['Column 1', 'Column 2', 'Column 3'],
      ['', '', ''],
      ['', '', ''],
    ],
  }),
  sticky: () => ({ w: STICKY_SIZE, h: STICKY_SIZE, html: '', tint: usePrefs.getState().stickyColor ?? DEFAULT_STICKY_COLOR }),
  frame: () => ({ w: 360, h: 240, title: 'Frame', color: 'slate', collapsed: false }),
  // These are made from a file (see store/media.ts); the sizes are only a fallback.
  audio: () => ({ w: 320, h: AUDIO_H, fileId: '', name: 'Audio' }),
  pdf: () => ({ w: 360, h: 480, fileId: '', name: 'PDF' }),
  // Made from a card (see store/cards.ts addCardBox). Its height follows the card tile.
  card: () => ({ w: 220, h: 40, cardId: '' }),
};

export const maxZ = (blocks: Block[]) => blocks.reduce((m, b) => Math.max(m, b.z || 0), 0);

export function addBlock(pageId: string, type: BlockType, pos: { x: number; y: number }, extra: NewBlockFields = {}): string {
  const page = get().pages[pageId];
  if (!page) return '';
  const id = newId();
  const base = type === 'image' ? { w: 320, h: 220 } : BLOCK_DEFAULTS[type]();
  const block = {
    ...base,
    ...extra,
    id,
    type,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    z: maxZ(page.blocks) + 1,
  } as Block;
  // A box created on top of a frame joins it automatically, same as dropping one in.
  if (type !== 'frame') {
    const dest = containingFrame(page.blocks, block, new Set());
    if (dest) block.frameId = dest.id;
  }
  mutatePage(pageId, (p) => {
    p.blocks.push(block as Draft<Block>);
  });
  return id;
}

export function deleteBlocks(pageId: string, ids: string[]) {
  const page = get().pages[pageId];
  if (!page) return;
  const drop = new Set(ids);
  // Deleting a frame ungroups its contents instead of orphaning them: anything whose
  // frameId chain leads to a deleted frame is reparented to the nearest surviving ancestor.
  const reparent = ungroupedAfterDelete(page.blocks, drop);
  mutatePage(pageId, (p) => {
    p.blocks = p.blocks.filter((b) => !drop.has(b.id));
    for (const b of p.blocks) if (reparent.has(b.id)) b.frameId = reparent.get(b.id) ?? null;
    p.arrows = p.arrows.filter((a) => !drop.has(a.from) && !drop.has(a.to));
  });
}

export function duplicateBlocks(pageId: string, ids: string[]): string[] {
  const page = get().pages[pageId];
  if (!page) return [];
  let z = maxZ(page.blocks);
  const selected = page.blocks.filter((b) => ids.includes(b.id));
  const idMap = new Map(selected.map((b) => [b.id, newId()]));
  const copies = selected.map((b) => {
    const c = deepClone(b) as Block;
    c.id = idMap.get(b.id)!;
    c.x = b.x + 24;
    c.y = b.y + 24;
    c.z = ++z;
    // Keep pointing at the original frame if it wasn't duplicated too; re-point at the
    // new copy if it was, so a duplicated frame+contents stay grouped together.
    if (c.frameId) c.frameId = idMap.get(c.frameId) ?? c.frameId;
    if (c.type === 'checklist') {
      c.items.forEach((i) => (i.id = newId()));
      delete c.track; // a copy starts with no daily history
    }
    return c;
  });
  mutatePage(pageId, (p) => {
    p.blocks.push(...(copies as Draft<Block>[]));
  });
  return copies.map((c) => c.id);
}

/** Groups ids by the frameId of the block they currently belong to. */
export function byParent(blocks: Block[], ids: string[]): Map<string | null, string[]> {
  const groups = new Map<string | null, string[]>();
  for (const id of ids) {
    const parent = blocks.find((b) => b.id === id)?.frameId ?? null;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent)!.push(id);
  }
  return groups;
}

/** Raise the given blocks above their siblings (within the same frame, if any). Not an undo step. */
export function bringToFront(pageId: string, ids: string[]) {
  const page = get().pages[pageId];
  if (!page || !ids.length) return;
  const groups = byParent(page.blocks, ids);
  const needsChange = [...groups].some(([parent, group]) => {
    const siblings = page.blocks.filter((b) => (b.frameId ?? null) === parent);
    const topIds = [...siblings].sort((a, b) => (b.z || 0) - (a.z || 0)).slice(0, group.length).map((b) => b.id);
    return !group.every((id) => topIds.includes(id));
  });
  if (!needsChange) return;
  mutatePage(
    pageId,
    (p) => {
      for (const [parent, group] of groups) {
        const siblings = p.blocks.filter((b) => (b.frameId ?? null) === parent);
        let z = siblings.reduce((m, b) => Math.max(m, b.z || 0), 0);
        for (const b of p.blocks) if (group.includes(b.id)) b.z = ++z;
      }
    },
    { history: 'none', touch: false },
  );
}

export function sendToBack(pageId: string, ids: string[]) {
  const page = get().pages[pageId];
  if (!page) return;
  const groups = byParent(page.blocks, ids);
  mutatePage(pageId, (p) => {
    for (const [parent, group] of groups) {
      const siblings = p.blocks.filter((b) => (b.frameId ?? null) === parent);
      let z = siblings.reduce((m, b) => Math.min(m, b.z || 0), Infinity) - group.length;
      for (const b of p.blocks) if (group.includes(b.id)) b.z = ++z;
    }
  });
}

