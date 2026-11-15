import { describe, expect, it } from 'vitest';
import { SLIDE_GAP, SLIDE_H, slideBlocks, slideContents, slidesOf } from '../src/lib/office/app';
import { deleteSlide, duplicateSlide, moveSlide, patchSlide } from '../src/lib/office/slideOps';
import type { Block } from '../src/types';

let n = 0;
const mk = () => `b${++n}`;
function deck(count: number): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < count; i++) for (const b of slideBlocks('content', { x: 0, y: i * (SLIDE_H + SLIDE_GAP) }, mk, { title: `Slide ${i + 1}`, lines: ['a'] })) out.push({ ...b, z: out.length + 1 } as Block);
  return out;
}
const titles = (blocks: readonly Block[]) =>
  slidesOf(blocks).map((s) => slideContents(blocks, s.id).map((b) => (b.type === 'note' ? b.html : '')).join('|').match(/Slide \d/)?.[0]);

describe('slides', () => {
  it('moving a slide swaps places with its neighbour, contents with it', () => {
    const d = deck(3);
    expect(titles(d)).toEqual(['Slide 1', 'Slide 2', 'Slide 3']);
    const first = slidesOf(d)[0].id;
    expect(titles(moveSlide(d, first, 1))).toEqual(['Slide 2', 'Slide 1', 'Slide 3']);
    const last = slidesOf(d)[2].id;
    expect(titles(moveSlide(d, last, -1))).toEqual(['Slide 1', 'Slide 3', 'Slide 2']);
  });
  it('the first cannot go up, the last cannot go down', () => {
    const d = deck(2);
    const [a, b] = slidesOf(d);
    expect(moveSlide(d, a.id, -1)).toBe(d);
    expect(moveSlide(d, b.id, 1)).toBe(d);
    expect(moveSlide(d, 'nope', 1)).toBe(d);
  });
  it('a copy goes right after the slide, with new ids and its contents, pushing later slides down', () => {
    const d = deck(3);
    const src = slidesOf(d)[0];
    const { blocks, id } = duplicateSlide(d, src.id);
    expect(titles(blocks)).toEqual(['Slide 1', 'Slide 1', 'Slide 2', 'Slide 3']);
    expect(id).not.toBe(src.id);
    expect(slideContents(blocks, id!)).toHaveLength(slideContents(d, src.id).length);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
    expect(slidesOf(blocks).map((s) => s.y)).toEqual([0, 1, 2, 3].map((i) => i * (SLIDE_H + SLIDE_GAP)));
  });
  it('a copy does not carry the original links', () => {
    const d = deck(1).map((b) => (b.type === 'note' ? { ...b, links: [{ page: 'p' }] } : b)) as Block[];
    const { blocks, id } = duplicateSlide(d, slidesOf(d)[0].id);
    expect(slideContents(blocks, id!).every((b) => !b.links)).toBe(true);
  });
  it('deleting removes the slide and its contents and closes the gap, but never the last slide', () => {
    const d = deck(3);
    const mid = slidesOf(d)[1];
    const after = deleteSlide(d, mid.id);
    expect(titles(after)).toEqual(['Slide 1', 'Slide 3']);
    expect(slidesOf(after).map((s) => s.y)).toEqual([0, SLIDE_H + SLIDE_GAP]);
    expect(after.some((b) => b.id === mid.id)).toBe(false);
    const one = deck(1);
    expect(deleteSlide(one, slidesOf(one)[0].id)).toBe(one);
  });
  it('changes a slide\'s notes and background', () => {
    const d = deck(1);
    const id = slidesOf(d)[0].id;
    const next = patchSlide(d, id, { notes: 'say hello', bg: 'blue' });
    expect(slidesOf(next)[0].slide).toEqual({ notes: 'say hello', bg: 'blue' });
    expect(slidesOf(d)[0].slide).toEqual({});
  });
});
