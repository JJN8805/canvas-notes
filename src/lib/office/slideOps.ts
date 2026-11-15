/** What can be done to the slides of a presentation (pure): move one up or down, copy one, delete one. Each returns the new boxes. */
import type { Block, FrameBlock } from '../../types';
import { frameDescendants } from '../frames';
import { newId } from '../util';
import { SLIDE_GAP, slidesOf } from './app';

/** Every box of a slide: its frame and what is inside. */
const partsOf = (blocks: readonly Block[], slideId: string): Block[] => {
  const ids = frameDescendants(blocks as Block[], slideId);
  return blocks.filter((b) => ids.has(b.id));
};

/** The slide one place earlier or later in the order (they swap places, contents with them). Returns the same array when it can't move. */
export function moveSlide(blocks: readonly Block[], slideId: string, dir: -1 | 1): readonly Block[] {
  const slides = slidesOf(blocks);
  const i = slides.findIndex((s) => s.id === slideId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= slides.length) return blocks;
  const a = slides[i];
  const b = slides[j];
  const shiftA = { x: b.x - a.x, y: b.y - a.y };
  const shiftB = { x: a.x - b.x, y: a.y - b.y };
  const inA = new Set(partsOf(blocks, a.id).map((x) => x.id));
  const inB = new Set(partsOf(blocks, b.id).map((x) => x.id));
  return blocks.map((x) => (inA.has(x.id) ? { ...x, x: x.x + shiftA.x, y: x.y + shiftA.y } : inB.has(x.id) ? { ...x, x: x.x + shiftB.x, y: x.y + shiftB.y } : x)) as Block[];
}

/** A copy of the slide, with its contents, placed right after it; the slides after it move down to make room. Returns the new slide's id too. */
export function duplicateSlide(blocks: readonly Block[], slideId: string): { blocks: Block[]; id: string | null } {
  const slides = slidesOf(blocks);
  const i = slides.findIndex((s) => s.id === slideId);
  if (i < 0) return { blocks: [...blocks], id: null };
  const src = slides[i];
  const step = src.h + SLIDE_GAP;
  const later = new Set(slides.slice(i + 1).flatMap((s) => partsOf(blocks, s.id).map((x) => x.id)));
  const moved = blocks.map((b) => (later.has(b.id) ? { ...b, y: b.y + step } : b)) as Block[];
  const parts = partsOf(blocks, slideId);
  const idMap = new Map(parts.map((b) => [b.id, newId()]));
  let z = blocks.reduce((m, b) => Math.max(m, b.z || 0), 0);
  const copies = parts.map((b) => {
    const c = structuredClone(b) as Block;
    c.id = idMap.get(b.id)!;
    c.y = b.y + step;
    c.z = ++z;
    delete c.links; // a copy starts without the original's links
    delete c.locked;
    if (c.frameId) c.frameId = idMap.get(c.frameId) ?? c.frameId;
    return c;
  });
  return { blocks: [...moved, ...copies], id: idMap.get(slideId) ?? null };
}

/** The slide and everything on it removed; the slides after it move up to close the gap. Never removes the last slide. */
export function deleteSlide(blocks: readonly Block[], slideId: string): readonly Block[] {
  const slides = slidesOf(blocks);
  const i = slides.findIndex((s) => s.id === slideId);
  if (i < 0 || slides.length < 2) return blocks;
  const gone = new Set(partsOf(blocks, slideId).map((x) => x.id));
  const step = slides[i].h + SLIDE_GAP;
  const later = new Set(slides.slice(i + 1).flatMap((s) => partsOf(blocks, s.id).map((x) => x.id)));
  return blocks.filter((b) => !gone.has(b.id)).map((b) => (later.has(b.id) ? { ...b, y: b.y - step } : b)) as Block[];
}

/** The slide's own settings changed (speaker notes, background). */
export function patchSlide(blocks: readonly Block[], slideId: string, patch: Partial<NonNullable<FrameBlock['slide']>>): readonly Block[] {
  return blocks.map((b) => (b.id === slideId && b.type === 'frame' && b.slide ? { ...b, slide: { ...b.slide, ...patch } } : b)) as Block[];
}
