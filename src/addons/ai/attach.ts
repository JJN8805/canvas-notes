/** Pages attached to a question in the Chat screen, and what a saved answer is called. Pure, so it is tested without the app. */
import type { Page } from '../../types';
import { buildPageContext, DEFAULT_MAX_CHARS } from './context';

export interface Attachments {
  /** One text per page, in the order attached. */
  texts: string[];
  /** The titles, for showing what was shared. */
  titles: string[];
  chars: number;
  /** At least one page was longer than its share of the limit and was cut. */
  truncated: boolean;
}

/** The most pages that can be attached to one question. */
export const MAX_ATTACHED = 5;

/**
 * The pages' text, sharing `total` characters between them. Pages that no longer exist (deleted meanwhile), repeats, and pages
 * with nothing in them are left out.
 */
export function buildAttachments(pages: Record<string, Page>, ids: readonly string[], total = DEFAULT_MAX_CHARS): Attachments {
  const found = [...new Set(ids)].map((id) => pages[id]).filter((p): p is Page => !!p).slice(0, MAX_ATTACHED);
  const share = Math.max(800, Math.floor(total / Math.max(1, found.length)));
  const out: Attachments = { texts: [], titles: [], chars: 0, truncated: false };
  for (const p of found) {
    const ctx = buildPageContext(p, [], share);
    if (!ctx.text.trim()) continue;
    out.texts.push(ctx.text);
    out.titles.push(p.title.trim() || 'Untitled');
    out.chars += ctx.chars;
    out.truncated ||= ctx.truncated;
  }
  return out;
}

/** A name for a page made from an answer: its first heading or line, without Markdown marks, at most 60 characters. */
export function titleFromAnswer(markdown: string, fallback = 'AI answer'): string {
  const line = markdown
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(#{1,6}|[-*+]|\d+[.)]|>)\s+/, '').replace(/[*_`~]/g, '').trim())
    .find((l) => l);
  if (!line) return fallback;
  return line.length > 60 ? line.slice(0, 59).trimEnd() + '…' : line;
}
