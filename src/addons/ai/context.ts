/** What the assistant is shown of a page. Pure, so it is tested without the app. */
import type { Block, Page } from '../../types';
import { htmlToText } from '../../graph/text';
import { readingOrder } from '../../export/export';

export interface PageContext {
  text: string;
  /** Length of `text`. */
  chars: number;
  /** The page was longer than the limit and the end was left out. */
  truncated: boolean;
  /** Boxes included. */
  blocks: number;
  /** Only the selected boxes were used. */
  usedSelection: boolean;
}

export const DEFAULT_MAX_CHARS = 24000;

function blockToText(b: Block): string {
  switch (b.type) {
    case 'text':
    case 'sticky':
      return htmlToText(b.html ?? '');
    case 'checklist':
      return b.items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n');
    case 'code':
      return '```\n' + (b.code ?? '') + '\n```';
    case 'table':
      return b.rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
    case 'frame':
      return b.title ? `## ${b.title}` : '';
    case 'image':
      return b.ocr ? `[Picture${b.alt ? `: ${b.alt}` : ''}. Text in it: ${b.ocr}]` : b.alt && !b.heat ? `[Picture: ${b.alt}]` : '';
    case 'audio':
      return `[Audio: ${b.name}]`;
    case 'pdf':
      return `[PDF: ${b.name}]`;
  }
}

/** The page as plain text in reading order; with `selectedIds` that match boxes on the page, only those boxes. */
export function buildPageContext(page: Pick<Page, 'title' | 'tags' | 'blocks'>, selectedIds: readonly string[] = [], maxChars = DEFAULT_MAX_CHARS): PageContext {
  const chosen = selectedIds.length ? page.blocks.filter((b) => selectedIds.includes(b.id)) : [];
  const usedSelection = chosen.length > 0;
  const blocks = readingOrder(usedSelection ? chosen : page.blocks);
  const head = [page.title ? `Title: ${page.title}` : '', !usedSelection && page.tags.length ? `Tags: ${page.tags.map((t) => `#${t}`).join(' ')}` : ''].filter(Boolean);
  const parts = blocks.map(blockToText).filter((t) => t.trim());
  let text = [...head, ...parts].join('\n\n');
  let truncated = false;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars).replace(/\s+\S*$/, '') + '\n\n[The rest of the page was left out because it is long.]';
    truncated = true;
  }
  return { text, chars: text.length, truncated, blocks: parts.length, usedSelection };
}
