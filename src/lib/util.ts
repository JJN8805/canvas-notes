import DOMPurify from 'dompurify';
import type { Block, GroupColor, NoteColor } from '../types';
import { GROUP_COLORS, NOTE_COLORS } from '../types';

export const GRID = 8;
export const snap = (v: number) => Math.round(v / GRID) * GRID;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function newId(): string {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return Date.now().toString(36) + rnd[0].toString(36) + rnd[1].toString(36).slice(0, 4);
}

export const deepClone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function colorVar(c: GroupColor | NoteColor | string): string {
  if ((NOTE_COLORS as readonly string[]).includes(c)) return `var(--n-${c})`;
  return `var(--c-${(GROUP_COLORS as readonly string[]).includes(c) ? c : 'slate'})`;
}

export function normTag(s: string): string {
  return s
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_\-.]/gu, '')
    .slice(0, 32);
}

export function timeAgo(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'Edited just now';
  if (s < 3600) return `Edited ${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `Edited ${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'Edited yesterday';
  const d = new Date(ts);
  return (
    'Edited ' +
    d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    })
  );
}

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr', 'span'];
const sanitizeCache = new Map<string, string>();

/** Sanitise stored rich text before rendering it outside the editor (thumbnails). */
export function sanitizeHtml(html: string): string {
  const hit = sanitizeCache.get(html);
  if (hit !== undefined) return hit;
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: ['href'] });
  if (sanitizeCache.size > 500) sanitizeCache.clear();
  sanitizeCache.set(html, clean);
  return clean;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|h\d|li|blockquote|pre)>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export const BLOCK_LABEL: Record<Block['type'], string> = {
  text: 'Text',
  image: 'Image',
  checklist: 'List',
  code: 'Code',
  table: 'Table',
  frame: 'Frame',
  sticky: 'Sticky',
  audio: 'Audio',
  pdf: 'PDF',
};

export function blockText(b: Block): string {
  switch (b.type) {
    case 'text':
    case 'sticky':
      return htmlToText(b.html);
    case 'checklist':
      return b.items.map((i) => i.text).join(' ');
    case 'code':
      return b.code;
    case 'table':
      return b.rows.flat().join(' ');
    case 'image':
      return b.ocr ?? ''; // text read from the picture by the OCR add-on
    case 'audio':
    case 'pdf':
      return b.name; // so a clip or document can be found by its name
    default:
      return '';
  }
}

/** Height of a frame's always-visible title bar; a collapsed frame shrinks to just this. */
export const FRAME_HEAD_H = 32;

/** Pictures, stickies, audio players and PDFs keep the height they were given; every other box grows with its content. */
export const isFixedHeight = (b: Block) => b.type === 'image' || b.type === 'sticky' || b.type === 'audio' || b.type === 'pdf';

export function blockHeight(b: Block): number {
  if (b.type === 'frame') return b.collapsed ? FRAME_HEAD_H : b.h;
  return isFixedHeight(b) ? b.h : Math.max(b.h, b.ah ?? 0);
}

export function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (el as HTMLElement).isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

const NON_TEXT_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'];

/** A field where typing makes text: editable, but not a checkbox, slider or other input that only looks like one to the keyboard. */
export function isTextEntry(el: Element | null): boolean {
  if (!isEditableTarget(el)) return false;
  return !(el!.tagName === 'INPUT' && NON_TEXT_INPUTS.includes((el as HTMLInputElement).type));
}

/** Something Space or Enter activates natively (a button, link, checkbox…), so the canvas must leave those keys alone. */
export const isActivatable = (el: Element | null): boolean =>
  !!el?.matches('button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"]');

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);
export const MOD_LABEL = isMac ? '⌘' : 'Ctrl';
