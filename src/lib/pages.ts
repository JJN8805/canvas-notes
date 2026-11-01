import type { Block, Page, PageKind } from '../types';
import { deepClone, newId } from './util';

export const kindOf = (p: { kind?: PageKind | string | null }): PageKind => (p.kind === 'template' ? 'template' : 'page');
export const isTemplate = (p: { kind?: PageKind | string | null }) => kindOf(p) === 'template';

/** The pages that belong in the library, search, tag lists and counts: everything except templates. */
export const libraryPages = (pages: Record<string, Page>): Page[] => Object.values(pages).filter((p) => !isTemplate(p));

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
