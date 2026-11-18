import type { Block, Page, PageKind } from '../types';
import { attendanceLink } from './attendance';
import { deepClone, newId } from './util';

export const kindOf = (p: { kind?: PageKind | string | null }): PageKind => (p.kind === 'template' || p.kind === 'card' ? p.kind : 'page');
export const isTemplate = (p: { kind?: PageKind | string | null }) => kindOf(p) === 'template';
export const isCard = (p: { kind?: PageKind | string | null }) => kindOf(p) === 'card';

/** Put away with Archive: kept, but out of the library, search, tag lists and counts. */
export const isArchived = (p: { archived?: boolean }) => p.archived === true;

/**
 * Whether a page can be archived: ordinary pages and cards. Not templates (they have their own screen), not the journal's daily pages (the
 * Journal makes a day's page again when it finds none, so hiding one would start a second page for that day) and not attendance pages.
 */
export const canArchive = (p: Page): boolean => (kindOf(p) === 'page' || kindOf(p) === 'card') && !cleanDate(p.dailyDate) && !attendanceLink(p);

/** The pages that belong in the library, search, tag lists and counts: everything except templates, cards and archived pages. */
export const libraryPages = (pages: Record<string, Page>): Page[] => Object.values(pages).filter((p) => kindOf(p) === 'page' && !isArchived(p));

/** The archive: archived pages and cards, the most recently archived-or-edited first. */
export const archivedPages = (pages: Record<string, Page>): Page[] =>
  Object.values(pages)
    .filter((p) => isArchived(p) && canArchive(p))
    .sort((a, b) => b.updated - a.updated);

/**
 * The pages the library lists (All pages, counts, groups, tags): the library pages without the journal's daily pages, which live in
 * the Journal. Search, the quick switcher, links and the Chat page picker still use `libraryPages`, so a day can be found anywhere.
 */
export const listedPages = (pages: Record<string, Page>): Page[] =>
  libraryPages(pages).filter((p) => !cleanDate(p.dailyDate) && !attendanceLink(p));

/** The attendance pages (made from tracked checklists), by title. They are read from the Journal's Attendance button, not listed in All pages. */
export const attendancePagesOf = (pages: Record<string, Page>): Page[] =>
  libraryPages(pages)
    .filter((p) => !!attendanceLink(p))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

/** The cards, by label (archived ones are in the Archive). */
export const cardsOf = (pages: Record<string, Page>): Page[] =>
  Object.values(pages)
    .filter((p) => isCard(p) && !isArchived(p))
    .sort((a, b) => (a.title || 'Untitled card').localeCompare(b.title || 'Untitled card'));

/** The templates, by name. */
export const templatesOf = (pages: Record<string, Page>): Page[] =>
  Object.values(pages)
    .filter(isTemplate)
    .sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'));

/** A valid YYYY-MM-DD date, or null. */
export const cleanDate = (d: unknown): string | null => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

type Content = Pick<Page, 'blocks' | 'arrows' | 'drawing'>;

/**
 * An independent copy of a page's contents: every box, checklist item and arrow gets a new id,
 * and frame membership and arrow ends are pointed at the new ids. Pictures are shared, since a stored picture never changes.
 */
export function cloneContent(src: Content): Content {
  // Only the contents are copied, never the page's own id, title, group or tags.
  const c = deepClone({ blocks: src.blocks, arrows: src.arrows, drawing: src.drawing ?? null });
  const idMap = new Map(c.blocks.map((b: Block) => [b.id, newId()]));
  c.blocks.forEach((b: Block) => {
    b.id = idMap.get(b.id)!;
    if (b.frameId) b.frameId = idMap.get(b.frameId) ?? null;
    if (b.type === 'checklist') {
      b.items.forEach((i) => (i.id = newId()));
      delete b.track; // a copy starts with no daily history
    }
  });
  c.arrows = c.arrows
    .filter((a) => idMap.has(a.from) && idMap.has(a.to))
    .map((a) => ({ ...a, id: newId(), from: idMap.get(a.from)!, to: idMap.get(a.to)! }));
  return c;
}

/** A new template made from a page: its layout and contents, but not its group, tags or date. */
export function templateFrom(src: Page, name: string, now = Date.now()): Page {
  return {
    ...cloneContent(src),
    id: newId(),
    kind: 'template',
    title: name,
    groupId: null,
    tags: [],
    dailyDate: null,
    color: src.color ?? null,
    sheet: src.sheet ?? null,
    cover: src.cover ?? null,
    icon: src.icon ?? null,
    created: now,
    updated: now,
    rev: 0,
  };
}

/**
 * The template a new daily page starts from, or null for a blank page.
 * `setting`: null = the built-in Daily page (if it still exists), 'none' = blank, otherwise a template's id
 * (a deleted or missing one falls back to the built-in).
 */
export function resolveDailyTemplate(pages: Record<string, Page>, setting: string | null, builtinId = 'tpl-daily'): Page | null {
  if (setting === 'none') return null;
  const pick = (id: string | null) => (id && pages[id] && isTemplate(pages[id]) ? pages[id] : null);
  return pick(setting) ?? pick(builtinId);
}
