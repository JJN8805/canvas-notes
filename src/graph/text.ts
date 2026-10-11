import type { Block } from '../types';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Visible text of a TipTap HTML string (no DOM needed, so it also runs in tests). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/pre)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** The searchable text of a block, stored in blocks.plain_text. */
export function blockPlainText(b: Block): string {
  switch (b.type) {
    case 'text':
      return htmlToText(b.html ?? '');
    case 'checklist':
      return b.items.map((i) => i.text).filter(Boolean).join('\n');
    case 'code':
      return b.code ?? '';
    case 'table':
      return b.rows.map((r) => r.join(' ')).join('\n').trim();
    case 'frame':
      return b.title ?? '';
    case 'image':
      return b.alt ?? '';
  }
}

/** Titles written as [[Page title]] in some text, in order of first appearance, without repeats (ignoring case). */
export function extractLinks(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(/\[\[([^\[\]\n]+?)\]\]/g)) {
    const title = m[1].trim();
    if (title && !seen.has(title.toLowerCase())) {
      seen.add(title.toLowerCase());
      out.push(title);
    }
  }
  return out;
}
