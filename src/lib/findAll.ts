/** "Find in every workspace": the pages (of every workspace, archived and templates left out) whose title or text has every word of the query. Pure. */
import type { Page } from '../types';
import { blockPlainText } from './pageText';
import { isArchived, kindOf } from './pages';
import { workspaceOf } from './workspaces';

export interface FoundPage {
  pageId: string;
  title: string;
  workspace: string;
  kind: string;
  /** A few words around the first hit in the text (empty when only the title matched). */
  snippet: string;
}

const SNIP = 70;

export function findEverywhere(pages: readonly Page[], query: string, limit = 40): FoundPage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: FoundPage[] = [];
  for (const p of pages) {
    if (kindOf(p) === 'template' || isArchived(p)) continue;
    const title = p.title.trim() || 'Untitled';
    const body = p.blocks.map(blockPlainText).join(' ').replace(/\s+/g, ' ').trim();
    const hay = `${title}\n${body}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const at = body.toLowerCase().indexOf(words[0]);
    const snippet = at < 0 ? '' : (at > SNIP / 2 ? '…' : '') + body.slice(Math.max(0, at - SNIP / 2), at + SNIP).trim() + (body.length > at + SNIP ? '…' : '');
    out.push({ pageId: p.id, title, workspace: workspaceOf(p), kind: kindOf(p), snippet });
  }
  // Titles that match first, then the most recently edited.
  const updated = new Map(pages.map((p) => [p.id, p.updated]));
  const inTitle = (f: FoundPage) => words.every((w) => f.title.toLowerCase().includes(w));
  return out.sort((a, b) => Number(inTitle(b)) - Number(inTitle(a)) || (updated.get(b.pageId) ?? 0) - (updated.get(a.pageId) ?? 0)).slice(0, limit);
}
