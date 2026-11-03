import { Block, Page, ChecklistBlock } from '../../types';
import { isTemplate } from '../../lib/pages';
import { attendanceBlocks, attendanceLink, attendanceTitle, rollover, startTracking, withAttendance } from '../../lib/attendance';
import { dateKey } from '../../lib/daily';
import type { Draft } from 'immer';
import { get, getStorage } from './state';
import { mutatePage, updateBlock } from './mutate';
import { createPage } from './pages';

/* ---------------- Daily tracking and attendance ---------------- */

export const trackedLists = (p: Page) => p.blocks.filter((b): b is ChecklistBlock => b.type === 'checklist' && !!b.track);

/** Starts or stops tracking a checklist day by day. Stopping forgets its daily record. */
export function setTracking(pageId: string, blockId: string, on: boolean) {
  const today = dateKey();
  updateBlock<ChecklistBlock>(pageId, blockId, (b) => {
    if (on) b.track = startTracking(b as ChecklistBlock, today);
    else delete b.track;
  });
}

/** The page that shows attendance for a checklist, if one was made. */
export function findAttendancePage(sourceId: string, blockId: string): Page | null {
  return (
    Object.values(get().pages).find((p) => {
      const l = attendanceLink(p);
      return !isTemplate(p) && l?.pageId === sourceId && l.blockId === blockId;
    }) ?? null
  );
}

/** Opens the attendance page for a tracked checklist, making it the first time. Returns its id. */
export function ensureAttendancePage(sourceId: string, blockId: string): string | null {
  const src = get().pages[sourceId];
  const list = src?.blocks.find((b): b is ChecklistBlock => b.id === blockId && b.type === 'checklist' && !!b.track);
  if (!src || !list) return null;
  const existing = findAttendancePage(sourceId, blockId);
  if (existing) {
    void refreshAttendance(existing.id);
    return existing.id;
  }
  // The heatmap pictures are drawn and stored just after (they need the image store), so the page starts without them.
  const { blocks } = attendanceBlocks(list, { pageId: sourceId, blockId }, src.title, dateKey());
  const page = createPage({
    title: attendanceTitle(src.title),
    groupId: src.groupId,
    tags: [],
    kind: 'page',
    blocks: blocks.filter((b) => b.type !== 'image'),
  });
  void refreshAttendance(page.id);
  return page.id;
}

/** How a heatmap drawing is stored as a picture. Replaceable so tests need no image store. */
let writeHeatmap = (svg: string): Promise<string> => getStorage().putImage(new Blob([svg], { type: 'image/svg+xml' }));
export function setHeatmapWriter(fn: (svg: string) => Promise<string>) {
  writeHeatmap = fn;
}

export const refreshing = new Map<string, boolean>();
/**
 * Rewrites an attendance page from its checklist (the checklist may have changed on another device, or a day may have passed).
 * A heatmap picture is only drawn and stored again when it differs from the one already on the page.
 */
export async function refreshAttendance(attendancePageId: string): Promise<void> {
  if (refreshing.has(attendancePageId)) {
    refreshing.set(attendancePageId, true); // changed again meanwhile: go round once more
    return;
  }
  try {
    do {
      refreshing.set(attendancePageId, false);
      await refreshAttendanceOnce(attendancePageId);
    } while (refreshing.get(attendancePageId));
  } catch (e) {
    console.warn('Could not update the attendance page', e);
  } finally {
    refreshing.delete(attendancePageId);
  }
}

export async function refreshAttendanceOnce(attendancePageId: string) {
  const att = get().pages[attendancePageId];
  const link = att && attendanceLink(att);
  const src = link && get().pages[link.pageId];
  const list = src && src.blocks.find((b): b is ChecklistBlock => b.id === link.blockId && b.type === 'checklist' && !!b.track);
  if (!att || !link || !src || !list) return;
  const { blocks, svgs } = attendanceBlocks(list, link, src.title, dateKey());
  for (const g of blocks) {
    if (g.type !== 'image') continue;
    const old = att.blocks.find((b) => b.id === g.id);
    g.imageId = old?.type === 'image' && old.heat === g.heat && old.imageId ? old.imageId : await writeHeatmap(svgs[g.id]);
  }
  const current = get().pages[attendancePageId];
  const next = current && withAttendance(current.blocks, blocks);
  if (!next) return;
  mutatePage(attendancePageId, (p) => void (p.blocks = next as Draft<Block>[]), { history: 'none' });
}

export const attendanceTimers = new Map<string, number>();
/** Updates every attendance page built from this page's lists, a moment after the last change. */
export function refreshAttendanceSoon(sourceId: string) {
  clearTimeout(attendanceTimers.get(sourceId));
  attendanceTimers.set(
    sourceId,
    window.setTimeout(() => {
      attendanceTimers.delete(sourceId);
      for (const p of Object.values(get().pages)) if (attendanceLink(p)?.pageId === sourceId) void refreshAttendance(p.id);
    }, 400),
  );
}

/**
 * Starts the new day for a page's tracked lists: their checks are cleared (yesterday's are already in the record).
 * Called when a page is open, never in the background. Returns whether anything was cleared.
 */
export function rolloverTracked(pageId: string, today = dateKey()): boolean {
  const p = get().pages[pageId];
  if (!p || isTemplate(p) || !trackedLists(p).some((b) => b.track!.day < today)) return false;
  mutatePage(
    pageId,
    (d) => {
      for (const b of d.blocks) if (b.type === 'checklist') rollover(b as ChecklistBlock, today);
    },
    { history: 'none' },
  );
  return true;
}

