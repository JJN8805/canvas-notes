import { Arrow, Block, type AddKind, type NoteBlock, type NoteStyle } from '../../types';
import { maxArrowZ } from './arrows';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE } from '../../lib/colors';
import { usePrefs } from '../prefs';
import { blockHeight, deepClone, newId } from '../../lib/util';
import { containingFrame, frameDescendants, ungroupedAfterDelete } from '../../lib/frames';
import { alignItems, distributeItems, type AlignMode, type DistributeAxis, type Item } from '../../lib/arrange';
import { freeIds } from '../../lib/lock';
import { markTargets, stepOrder, type Step } from '../../lib/layers';
import type { Draft } from 'immer';
import { get } from './state';
import { mutatePage } from './mutate';
import { setNoteStyle } from '../../lib/note';

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

/** Height of an audio player box: its name above the player. */
export const AUDIO_H = 88;

export type NewBlockFields = Partial<Omit<Block, 'id' | 'type'>> & Record<string, unknown>;

export const BLOCK_DEFAULTS: Record<Exclude<AddKind, 'image'>, () => NewBlockFields> = {
  text: () => ({ style: 'text', w: 280, h: 40, html: '' }),
  checklist: () => ({ w: 288, h: 48, items: [{ id: newId(), text: '', done: false }] }),
  code: () => ({ style: 'code', w: 432, h: 72, html: '', code: '' }),
  table: () => ({
    w: 384,
    h: 72,
    rows: [
      ['Column 1', 'Column 2', 'Column 3'],
      ['', '', ''],
      ['', '', ''],
    ],
  }),
  sticky: () => ({ style: 'sticky', w: STICKY_SIZE, h: STICKY_SIZE, html: '', tint: usePrefs.getState().stickyColor ?? DEFAULT_STICKY_COLOR }),
  frame: () => ({ w: 360, h: 240, title: 'Frame', color: 'slate', collapsed: false }),
  // These are made from a file (see store/media.ts); the sizes are only a fallback.
  audio: () => ({ w: 320, h: AUDIO_H, fileId: '', name: 'Audio' }),
  pdf: () => ({ w: 360, h: 480, fileId: '', name: 'PDF' }),
  // Made from a card (see store/cards.ts addCardBox). Its height follows the card tile.
  card: () => ({ w: 220, h: 40, cardId: '' }),
};

export const maxZ = (blocks: Block[]) => blocks.reduce((m, b) => Math.max(m, b.z || 0), 0);

/** `opts.arrowFrom`: also join the new box to that one with an arrow, in the same undo step (Tab on a selected box). */
export function addBlock(pageId: string, kind: AddKind, pos: { x: number; y: number }, extra: NewBlockFields = {}, opts: { arrowFrom?: string } = {}): string {
  const page = get().pages[pageId];
  if (!page) return '';
  const id = newId();
  const type = kind === 'text' || kind === 'sticky' || kind === 'code' ? 'note' : kind; // the three styles of note are one box type
  const base = kind === 'image' ? { w: 320, h: 220 } : BLOCK_DEFAULTS[kind]();
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
  const from = opts.arrowFrom && opts.arrowFrom !== id && page.blocks.some((b) => b.id === opts.arrowFrom) ? opts.arrowFrom : null;
  mutatePage(pageId, (p) => {
    p.blocks.push(block as Draft<Block>);
    if (from) p.arrows.push({ id: newId(), from, to: id, heads: 'one', style: 'solid', z: maxArrowZ(p.arrows as Arrow[]) + 1 } as Draft<Arrow>);
  });
  return id;
}

/** Deletes the boxes that are not locked; returns how many went. */
export function deleteBlocks(pageId: string, ids: string[]): number {
  const page = get().pages[pageId];
  if (!page) return 0;
  const free = freeIds(page.blocks, ids);
  if (!free.length) return 0;
  const drop = new Set(free);
  // Deleting a frame ungroups its contents instead of orphaning them: anything whose
  // frameId chain leads to a deleted frame is reparented to the nearest surviving ancestor.
  const reparent = ungroupedAfterDelete(page.blocks, drop);
  mutatePage(pageId, (p) => {
    p.blocks = p.blocks.filter((b) => !drop.has(b.id));
    for (const b of p.blocks) if (reparent.has(b.id)) b.frameId = reparent.get(b.id) ?? null;
    p.arrows = p.arrows.filter((a) => !drop.has(a.from) && !drop.has(a.to));
  });
  return free.length;
}

/**
 * Switch a note between text, sticky and code (one undo step). Words are kept; going to code drops the formatting.
 * A sticky takes the sticky size and a colour; leaving one lets the box grow with its text again.
 */
export const setNoteStyleOf = (pageId: string, blockId: string, style: NoteStyle) => setNoteStyles(pageId, [blockId], style);

/** The same for several notes at once, as ONE undo step. Boxes that are not notes, are locked or already have the style are left out. */
export function setNoteStyles(pageId: string, ids: string[], style: NoteStyle) {
  const page = get().pages[pageId];
  const change = new Set((page?.blocks ?? []).filter((b) => ids.includes(b.id) && b.type === 'note' && b.style !== style && !b.locked).map((b) => b.id));
  if (!change.size) return;
  mutatePage(pageId, (p) => {
    for (const n of p.blocks) {
      if (!change.has(n.id) || n.type !== 'note') continue;
      applyStyle(n as Draft<NoteBlock>, style);
    }
  });
}

function applyStyle(n: Draft<NoteBlock>, style: NoteStyle) {
  const was = n.style;
  setNoteStyle(n as NoteBlock, style);
  if (style === 'sticky') {
    n.w = STICKY_SIZE;
    n.h = STICKY_SIZE;
    n.tint = n.tint ?? usePrefs.getState().stickyColor ?? DEFAULT_STICKY_COLOR;
  } else if (was === 'sticky') {
    n.h = 40;
  }
}

/** Lock or unlock boxes (one undo step). */
export function setLocked(pageId: string, ids: string[], locked: boolean) {
  const page = get().pages[pageId];
  if (!page || !page.blocks.some((b) => ids.includes(b.id) && !!b.locked !== locked)) return;
  mutatePage(pageId, (p) => {
    for (const b of p.blocks) {
      if (!ids.includes(b.id)) continue;
      if (locked) b.locked = true;
      else delete b.locked;
    }
  });
}

/** Copies of the boxes, and of everything inside a frame among them (so Ctrl+D and Ctrl+drag agree). Returns the copies of `ids`. */
export function duplicateBlocks(pageId: string, ids: string[]): string[] {
  const map = duplicateBlocksMap(pageId, ids);
  return ids.map((id) => map.get(id)).filter((id): id is string => !!id);
}

/** Duplicates boxes and says which copy belongs to which original. `history: 'none'` for use inside a drag gesture, which is one undo step by itself. */
export function duplicateBlocksMap(pageId: string, ids: string[], opts: { history?: 'none' } = {}): Map<string, string> {
  const page = get().pages[pageId];
  if (!page) return new Map();
  let z = maxZ(page.blocks);
  // A frame is copied with what is inside it.
  const want = new Set(ids);
  for (const id of ids) if (page.blocks.find((b) => b.id === id)?.type === 'frame') for (const d of frameDescendants(page.blocks, id)) want.add(d);
  const selected = page.blocks.filter((b) => want.has(b.id));
  const idMap = new Map(selected.map((b) => [b.id, newId()]));
  const copies = selected.map((b) => {
    const c = deepClone(b) as Block;
    c.id = idMap.get(b.id)!;
    c.x = b.x + 24;
    c.y = b.y + 24;
    c.z = ++z;
    delete c.locked;
    // Keep pointing at the original frame if it wasn't duplicated too; re-point at the
    // new copy if it was, so a duplicated frame+contents stay grouped together.
    if (c.frameId) c.frameId = idMap.get(c.frameId) ?? c.frameId;
    if (c.type === 'checklist') {
      c.items.forEach((i) => (i.id = newId()));
      delete c.track; // a copy starts with no daily history
    }
    return c;
  });
  mutatePage(
    pageId,
    (p) => {
      p.blocks.push(...(copies as Draft<Block>[]));
    },
    opts.history ? { history: opts.history } : {},
  );
  return idMap;
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
/** Brings the boxes to the front of those they are stacked with. Clicking or dragging a box does this quietly (no undo step); `undoable` is for the explicit command. */
export function bringToFront(pageId: string, ids: string[], opts: { undoable?: boolean } = {}) {
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
    opts.undoable ? {} : { history: 'none', touch: false },
  );
}

/** One place forward or backward among the boxes each one is stacked with. One undo step; nothing happens at the end of the stack. */
export function stepBlocks(pageId: string, ids: string[], dir: Step) {
  const page = get().pages[pageId];
  if (!page || !ids.length) return;
  const changes = stepOrder(page.blocks, ids, dir);
  if (!changes.size) return;
  mutatePage(pageId, (p) => {
    for (const b of p.blocks) {
      const z = changes.get(b.id);
      if (z !== undefined) b.z = z;
    }
  });
}

/** Paints the boxes (with their frame's contents) over the page's drawing instead of under it, or back under. One undo step. */
export function setOverDrawing(pageId: string, ids: string[], over: boolean) {
  const page = get().pages[pageId];
  if (!page) return;
  const targets = new Set(markTargets(page.blocks, ids));
  if (!page.blocks.some((b) => targets.has(b.id) && !!b.over !== over)) return;
  mutatePage(pageId, (p) => {
    for (const b of p.blocks) {
      if (!targets.has(b.id)) continue;
      if (over) b.over = true;
      else delete b.over;
    }
  });
}

export function sendToBack(pageId: string, ids: string[]) {
  const page = get().pages[pageId];
  if (!page) return;
  const groups = byParent(page.blocks, ids);
  mutatePage(pageId, (p) => {
    for (const [parent, group] of groups) {
      const siblings = p.blocks.filter((b) => (b.frameId ?? null) === parent);
      // Strictly below the lowest box left behind (a tie would leave the order to chance).
      const lowest = p.blocks.filter((b) => (b.frameId ?? null) === parent && !group.includes(b.id)).reduce((m, b) => Math.min(m, b.z || 0), Infinity);
      let z = (Number.isFinite(lowest) ? lowest : siblings.reduce((m, b) => Math.min(m, b.z || 0), Infinity)) - group.length - 1;
      for (const b of p.blocks) if (group.includes(b.id)) b.z = ++z;
    }
  });
}


/* ------------------------------------------------------------------ */
/* Align and distribute                                                */
/* ------------------------------------------------------------------ */

/**
 * Align or spread the selected boxes in ONE undo step. Boxes inside a selected frame travel with it and never count on their own,
 * so a frame and its contents are not pulled apart. Returns whether anything moved.
 */
export function arrangeBlocks(pageId: string, ids: string[], how: AlignMode | { distribute: DistributeAxis }): boolean {
  const page = get().pages[pageId];
  if (!page) return false;
  const sel = new Set(ids);
  const carried = new Set<string>();
  for (const b of page.blocks) {
    if (sel.has(b.id) && b.type === 'frame') for (const d of frameDescendants(page.blocks, b.id)) if (d !== b.id) carried.add(d);
  }
  const items: Item[] = page.blocks
    .filter((b) => sel.has(b.id) && !carried.has(b.id) && !b.locked)
    .map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: blockHeight(b) }));
  const moves = typeof how === 'string' ? alignItems(items, how) : distributeItems(items, how.distribute);
  if (!moves.size) return false;
  mutatePage(page.id, (p) => {
    for (const [id, m] of moves) {
      const dx = m.x === undefined ? 0 : m.x - (p.blocks.find((b) => b.id === id)?.x ?? 0);
      const dy = m.y === undefined ? 0 : m.y - (p.blocks.find((b) => b.id === id)?.y ?? 0);
      const moving = new Set([id, ...(p.blocks.find((b) => b.id === id)?.type === 'frame' ? frameDescendants(p.blocks as Block[], id) : [])]);
      for (const b of p.blocks) {
        if (!moving.has(b.id)) continue;
        b.x += dx;
        b.y += dy;
      }
    }
  });
  return true;
}
