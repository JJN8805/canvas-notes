/**
 * The library's search box. Plain words must all appear (title, tags or text, any order); the rest narrow the pages:
 *   #travel or tag:travel     the page has exactly that tag
 *   has:image                 the page has a box of that kind (text, image, checklist, code, table, frame, sticky, audio, pdf) or has:drawing
 *   in:work                   the page is in a group whose name contains this (its subgroups count too)
 *   after:2026-01-01          last edited on or after that day (local time)
 *   before:2026-02-01         last edited before the end of that day
 * "quoted words" must appear together. An operator with nothing usable after it is ignored rather than hiding every page.
 */
import type { Group, Page } from '../types';
import { withDescendants } from './groups';
import { blockText, normTag } from './util';
import { cleanDate } from './pages';

export const BLOCK_KINDS = ['text', 'image', 'checklist', 'code', 'table', 'frame', 'sticky', 'audio', 'pdf', 'drawing'] as const;

export interface ParsedQuery {
  words: string[];
  tags: string[];
  has: string[];
  groups: string[];
  after: number | null;
  before: number | null;
}

/** Splits on spaces, keeping "quoted phrases" whole. */
function tokens(q: string): string[] {
  return Array.from(q.matchAll(/"([^"]*)"|(\S+)/g), (m) => (m[1] ?? m[2]).trim()).filter(Boolean);
}

/** Start of the local day for a YYYY-MM-DD date. */
const dayStart = (d: string): number | null => {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(y, m - 1, day);
  // Date rolls 2026-02-30 over to March 2; a real day reads back as the same year, month and day.
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === day ? t.getTime() : null;
};

export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { words: [], tags: [], has: [], groups: [], after: null, before: null };
  for (const [raw] of q.matchAll(/\S*"[^"]*"|\S+/g)) {
    const lower = raw.toLowerCase();
    const op = lower.match(/^(tag|has|in|after|before):(.*)$/);
    if (lower.startsWith('#')) {
      const t = normTag(lower);
      if (t) out.tags.push(t);
    } else if (op) {
      const v = op[2].replace(/"/g, '').trim();
      if (op[1] === 'tag' && normTag(v)) out.tags.push(normTag(v));
      else if (op[1] === 'has' && (BLOCK_KINDS as readonly string[]).includes(v)) out.has.push(v);
      else if (op[1] === 'in' && v) out.groups.push(v);
      else if (op[1] === 'after' && cleanDate(v)) out.after = dayStart(v);
      else if (op[1] === 'before' && cleanDate(v)) {
        const t = dayStart(v);
        out.before = t === null ? null : t + 24 * 3600 * 1000 - 1;
      }
    } else {
      for (const t of tokens(raw)) out.words.push(t.toLowerCase());
    }
  }
  return out;
}

export const hasFilters = (p: ParsedQuery) => !!(p.tags.length || p.has.length || p.groups.length || p.after !== null || p.before !== null);

/** The pages that match, in the order given. `groups` is needed only for `in:`. */
export function searchPages(pages: Page[], query: string, groups: Group[] = []): Page[] {
  const q = parseQuery(query);
  if (!q.words.length && !hasFilters(q)) return pages;
  // Each `in:` term becomes the set of group ids it names (those groups and everything inside them).
  const inSets = q.groups.map((name) => {
    const ids = new Set<string>();
    for (const g of groups) if (g.name.toLowerCase().includes(name.toLowerCase())) withDescendants(groups, g.id).forEach((id) => ids.add(id));
    return ids;
  });
  return pages.filter((p) => {
    if (!q.tags.every((t) => p.tags.includes(t))) return false;
    if (!q.has.every((k) => (k === 'drawing' ? !!p.drawing : p.blocks.some((b) => b.type === k)))) return false;
    if (!inSets.every((s) => !!p.groupId && s.has(p.groupId))) return false;
    if (q.after !== null && p.updated < q.after) return false;
    if (q.before !== null && p.updated > q.before) return false;
    if (!q.words.length) return true;
    const hay = [p.title, p.tags.join(' '), ...p.blocks.map(blockText)].join(' ').toLowerCase();
    return q.words.every((w) => hay.includes(w));
  });
}
