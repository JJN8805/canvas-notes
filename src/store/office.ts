/** Making and changing Workspace pages (documents, spreadsheets, presentations). Every change goes through `mutatePage`/`updateBlock`, so undo, saving and sync work as for any page. */
import type { Block, CalcMeta, NoteBlock, Page, TableBlock } from '../types';
import { sheetBlock, docBlock, nextSlideSpot, slideBlocks, slidesOf, type OfficeApp, type SlideLayout } from '../lib/office/app';
import type { GridState } from '../lib/office/sheetModel';
import { deleteSlide, duplicateSlide, moveSlide, patchSlide } from '../lib/office/slideOps';
import { DOC_WIDTH, starterById, startersFor, type Starter } from '../lib/office/starters';
import { newId } from '../lib/util';
import { createPage, mutatePage, updateBlock, useNotes } from './notes';
import type { Draft } from 'immer';

/** A new page from a starter (a blank one when none is named). Workspace pages have no edges: the screen is the page. */
export function createOfficePage(app: OfficeApp, starterId?: string): Page | null {
  const starter: Starter | undefined = (starterId ? starterById(starterId) : undefined) ?? startersFor(app)[0];
  if (!starter || starter.app !== app) return null;
  const built = starter.build('w' + newId().slice(0, 6));
  return createPage({ title: built.title, blocks: built.blocks as Block[], arrows: built.arrows ?? [], sheet: null });
}

/** A Word, Excel or CSV file opened as a new page. Throws a message fit to show when the file can't be read. */
export async function importOfficeFile(file: File): Promise<Page> {
  const { openOfficeFile } = await import('../export/officeImport');
  const opened = await openOfficeFile(file);
  return createPage({ title: opened.title, blocks: opened.blocks, arrows: [], sheet: null });
}

/* ---------------- spreadsheets ---------------- */

const stateOf = (b: TableBlock): GridState => ({ rows: b.rows, fmt: b.calc?.fmt ?? {}, colW: b.calc?.colW ?? {} });

/** The sheet of a page as the model sees it, or null. */
export function gridOf(page: Pick<Page, 'blocks'> | undefined): GridState | null {
  const b = page ? sheetBlock(page.blocks) : undefined;
  return b ? stateOf(b) : null;
}

/**
 * Change the cells with a pure function of the grid (insert, sort, paste, format…). `key` joins consecutive edits of one kind (typing in
 * a cell) into one undo step; leave it out for a step of its own.
 */
export function editSheet(pageId: string, change: (s: GridState) => GridState, key?: string) {
  updateBlock<TableBlock>(
    pageId,
    sheetBlock(useNotes.getState().pages[pageId]?.blocks ?? [])?.id ?? '',
    (b) => {
      const next = change(stateOf(b as TableBlock));
      b.rows = next.rows;
      const calc: CalcMeta = { page: true, ...(b.calc?.freeze ? { freeze: b.calc.freeze } : {}) };
      if (Object.keys(next.fmt).length) calc.fmt = next.fmt;
      if (Object.keys(next.colW).length) calc.colW = next.colW;
      b.calc = calc;
    },
    key ? { history: { key } } : undefined,
  );
}

/** How many of the top rows stay in view (0 = none). */
export function setFreeze(pageId: string, rows: number) {
  updateBlock<TableBlock>(pageId, sheetBlock(useNotes.getState().pages[pageId]?.blocks ?? [])?.id ?? '', (b) => {
    if (!b.calc) return;
    if (rows > 0) b.calc.freeze = rows;
    else delete b.calc.freeze;
  });
}

/* ---------------- documents ---------------- */

export function setDocSize(pageId: string, size: 'letter' | 'a4') {
  const doc = docBlock(useNotes.getState().pages[pageId]?.blocks ?? []);
  if (!doc) return;
  updateBlock<NoteBlock>(pageId, doc.id, (b) => {
    b.doc = { page: true, size };
    b.w = DOC_WIDTH[size];
  });
}

/* ---------------- presentations ---------------- */

const blocksOf = (pageId: string): readonly Block[] => useNotes.getState().pages[pageId]?.blocks ?? [];
const replace = (pageId: string, blocks: readonly Block[]) => {
  if (blocks === blocksOf(pageId)) return; // nothing changed: no undo step
  mutatePage(pageId, (p) => void (p.blocks = blocks as Draft<Block>[]));
};

/** A new slide at the end; returns its id. */
export function addSlide(pageId: string, layout: SlideLayout): string | null {
  const blocks = blocksOf(pageId);
  const made = slideBlocks(layout, nextSlideSpot(blocks), newId);
  let z = blocks.reduce((m, b) => Math.max(m, b.z || 0), 0);
  replace(pageId, [...blocks, ...made.map((b) => ({ ...b, z: ++z }) as Block)]);
  return made[0]?.id ?? null;
}
export const moveSlideBy = (pageId: string, slideId: string, dir: -1 | 1) => replace(pageId, moveSlide(blocksOf(pageId), slideId, dir));
export const removeSlide = (pageId: string, slideId: string) => replace(pageId, deleteSlide(blocksOf(pageId), slideId));
export function copySlide(pageId: string, slideId: string): string | null {
  const r = duplicateSlide(blocksOf(pageId), slideId);
  if (r.id) replace(pageId, r.blocks);
  return r.id;
}
export const setSlide = (pageId: string, slideId: string, patch: Parameters<typeof patchSlide>[2]) => replace(pageId, patchSlide(blocksOf(pageId), slideId, patch));
export const slideIds = (pageId: string): string[] => slidesOf(blocksOf(pageId)).map((s) => s.id);
