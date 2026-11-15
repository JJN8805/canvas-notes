/**
 * Workspace pages (pure). A document, a spreadsheet and a presentation are ordinary pages: what makes one of them "an app page" is a
 * marker on one of its boxes, not a new kind of page. So storage, sync, backup, search and export need nothing new, and an older
 * version of the app, which ignores the marker, shows the same page as a canvas.
 */
import type { Block, FrameBlock, Page, TableBlock, NoteBlock } from '../../types';
import { frameDescendants } from '../frames';

export type OfficeApp = 'doc' | 'sheet' | 'slides';

export const OFFICE_LABEL: Record<OfficeApp, string> = { doc: 'Document', sheet: 'Spreadsheet', slides: 'Presentation' };

/** The spreadsheet of a spreadsheet page: its table. */
export const sheetBlock = (blocks: readonly Block[]): TableBlock | undefined => blocks.find((b): b is TableBlock => b.type === 'table' && !!b.calc?.page);
/** The text of a document page. */
export const docBlock = (blocks: readonly Block[]): NoteBlock | undefined => blocks.find((b): b is NoteBlock => b.type === 'note' && !!b.doc?.page);

export const isSlide = (b: Block): b is FrameBlock => b.type === 'frame' && !!b.slide;

/** What kind of Workspace page this is, or null for an ordinary page. */
export function pageApp(page: Pick<Page, 'blocks'> | undefined | null): OfficeApp | null {
  if (!page) return null;
  if (sheetBlock(page.blocks)) return 'sheet';
  if (docBlock(page.blocks)) return 'doc';
  if (page.blocks.some(isSlide)) return 'slides';
  return null;
}

/* ------------------------------------------------------------------ */
/* Slides                                                              */
/* ------------------------------------------------------------------ */

export const SLIDE_W = 960;
export const SLIDE_H = 540;
export const SLIDE_GAP = 80;

/** The slides in order: top to bottom, and left to right when they share a row. */
export const slidesOf = (blocks: readonly Block[]): FrameBlock[] => blocks.filter(isSlide).sort((a, b) => a.y - b.y || a.x - b.x);

/** What is on a slide: everything inside its frame, in paint order. */
export function slideContents(blocks: readonly Block[], slideId: string): Block[] {
  const inside = frameDescendants(blocks as Block[], slideId);
  inside.delete(slideId);
  return blocks.filter((b) => inside.has(b.id)).sort((a, b) => (a.z || 0) - (b.z || 0));
}

/** The slide a box belongs to (the box itself when it is a slide), or null. */
export function slideOfBlock(blocks: readonly Block[], id: string): FrameBlock | null {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  let cur = byId.get(id);
  for (let guard = 0; cur && guard < 50; guard++) {
    if (isSlide(cur)) return cur;
    cur = cur.frameId ? byId.get(cur.frameId) : undefined;
  }
  return null;
}

/** Where the next slide goes: below the last one, in line with the first. */
export function nextSlideSpot(blocks: readonly Block[]): { x: number; y: number } {
  const slides = slidesOf(blocks);
  if (!slides.length) return { x: 0, y: 0 };
  const last = slides[slides.length - 1];
  return { x: slides[0].x, y: last.y + last.h + SLIDE_GAP };
}

export type SlideLayout = 'title' | 'content' | 'two' | 'section' | 'blank';

export const SLIDE_LAYOUTS: { id: SlideLayout; label: string; hint: string }[] = [
  { id: 'title', label: 'Title slide', hint: 'A big title and a line under it' },
  { id: 'content', label: 'Title and bullets', hint: 'A heading and a list' },
  { id: 'two', label: 'Two columns', hint: 'A heading and two blocks of text' },
  { id: 'section', label: 'Section heading', hint: 'One large statement' },
  { id: 'blank', label: 'Blank', hint: 'An empty slide' },
];

const big = (tag: string, text: string, px: number, align?: 'center') =>
  `<${tag}${align ? ` style="text-align: ${align}"` : ''}><span style="font-size: ${px}px">${text}</span></${tag}>`;
const para = (text: string, px: number, align?: 'center') => `<p${align ? ` style="text-align: ${align}"` : ''}><span style="font-size: ${px}px">${text}</span></p>`;
const bullets = (items: string[], px: number) => `<ul>${items.map((i) => `<li><p><span style="font-size: ${px}px">${i}</span></p></li>`).join('')}</ul>`;

export interface SlideText {
  title?: string;
  /** Subtitle, or the two columns' text, or the bullets. */
  lines?: string[];
}

/** The boxes of one slide: its frame first, then what is on it. `z` is left for the caller to set. */
export function slideBlocks(layout: SlideLayout, at: { x: number; y: number }, mkId: () => string, text: SlideText = {}): Block[] {
  const frameId = mkId();
  const frame = { id: frameId, type: 'frame', x: at.x, y: at.y, w: SLIDE_W, h: SLIDE_H, z: 0, title: 'Slide', color: 'slate', collapsed: false, slide: {} } as FrameBlock;
  const textBox = (x: number, y: number, w: number, html: string): Block =>
    ({ id: mkId(), type: 'note', style: 'text', x: at.x + x, y: at.y + y, w, h: 40, z: 0, html, frameId }) as NoteBlock;
  const title = text.title;
  const lines = text.lines ?? [];
  switch (layout) {
    case 'title':
      return [frame, textBox(80, 170, 800, big('h1', title ?? 'Title', 56, 'center') + para(lines[0] ?? 'Subtitle', 26, 'center'))];
    case 'content':
      return [frame, textBox(60, 40, 840, big('h1', title ?? 'Title', 40)), textBox(60, 150, 840, bullets(lines.length ? lines : ['First point', 'Second point', 'Third point'], 26))];
    case 'two': {
      const mid = Math.ceil(lines.length / 2);
      const left = lines.slice(0, mid);
      const right = lines.slice(mid);
      return [
        frame,
        textBox(60, 40, 840, big('h1', title ?? 'Title', 40)),
        textBox(60, 150, 400, bullets(left.length ? left : ['Left column'], 24)),
        textBox(500, 150, 400, bullets(right.length ? right : ['Right column'], 24)),
      ];
    }
    case 'section':
      return [frame, textBox(80, 190, 800, big('h1', title ?? 'Section', 60) + (lines[0] ? para(lines[0], 24) : ''))];
    default:
      return [frame];
  }
}
