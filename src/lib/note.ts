/**
 * The note: one box for text, sticky notes and code (`NoteBlock`, `style`). Pure helpers: the type guards, turning boxes stored in the
 * old three-type form into notes, and switching a note between styles without losing what was written.
 */
import type { Block, NoteBlock, NoteStyle } from '../types';
import { htmlToText } from './pageText';
import { escapeHtml, textToHtml } from './util';

export const isNote = (b: { type: string }): b is NoteBlock => b.type === 'note';
/** A note of this style (a type guard, so the fields of a note are available afterwards). */
export const isStyle = (b: { type: string; style?: unknown }, style: NoteStyle): b is NoteBlock => b.type === 'note' && b.style === style;
export const isSticky = (b: { type: string; style?: unknown }): b is NoteBlock => isStyle(b, 'sticky');
export const isCode = (b: { type: string; style?: unknown }): b is NoteBlock => isStyle(b, 'code');
/** A note written as text (a text box or a sticky), as opposed to code: its content is `html`. */
export const isRich = (b: { type: string; style?: unknown }): b is NoteBlock => b.type === 'note' && b.style !== 'code';

/** The word the stylesheet knows a box by: a note's style (text, sticky, code), or the type of any other box. Gives the `b-…` class. */
export const kindClass = (b: { type: string; style?: unknown }): string => (b.type === 'note' ? cleanStyle(b.style) : b.type);

export const cleanStyle = (v: unknown): NoteStyle => (v === 'sticky' || v === 'code' ? v : 'text');


/**
 * A box stored before notes existed ('text', 'sticky' or 'code') as a note; anything else is returned as it is.
 * Used when pages are read, so the rest of the app only ever sees notes.
 */
export function legacyNote<T extends Record<string, unknown>>(b: T): T | (Record<string, unknown> & { type: 'note' }) {
  if (b.type === 'text' || b.type === 'sticky') return { ...b, type: 'note', style: b.type };
  if (b.type === 'code') {
    const { code, ...rest } = b;
    return { ...rest, type: 'note', style: 'code', html: '', code: typeof code === 'string' ? code : '' };
  }
  return b;
}

/** What a note says, as plain text (any style). */
export const noteText = (b: NoteBlock): string => {
  const body = b.style === 'code' ? (b.code ?? '') : htmlToText(b.html);
  return b.header ? `${b.header}\n${body}`.trim() : body;
};

/** The header of a text box, as stored: one line of at most 200 characters, or null when the box has none. */
export const cleanHeader = (v: unknown): string | null => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 200) : null);

/** Whether this note shows a header: a text box or a sticky can have one (not code, and not a document's text). */
export const hasHeader = (b: { type?: string; style?: string; header?: string; doc?: unknown }): boolean => b.type === 'note' && (b.style === 'text' || b.style === 'sticky') && typeof b.header === 'string' && !b.doc;

/** A header box folded down to its header. */
export const isFolded = (b: { type?: string; style?: string; header?: string; folded?: boolean; doc?: unknown }): boolean => hasHeader(b) && b.folded === true;

/**
 * Change a note's style in place. Code is plain text, so going to it keeps the words and drops the formatting; coming back from it
 * puts each line in a paragraph. `fill` only means something for text, so it is dropped elsewhere.
 */
export function setNoteStyle(b: NoteBlock, style: NoteStyle): void {
  if (b.style === style) return;
  // A header goes with the box between text and sticky. Code has none: going there keeps the title as the first line of the code.
  if (typeof b.header === 'string' && style === 'code') {
    if (b.header) b.html = `<p>${escapeHtml(b.header)}</p>${b.html}`;
    delete b.header;
    delete b.folded;
  }
  if (style === 'code') {
    b.code = htmlToText(b.html);
    b.html = '';
    delete b.fill;
    delete b.doc;
  } else if (b.style === 'code') {
    b.html = textToHtml(b.code ?? '');
    delete b.code;
  }
  if (style !== 'text') delete b.fill;
  b.style = style;
}

/** Whether going to `style` would lose formatting (headings, bold, lists…), so the person should be told first. */
export const losesFormatting = (b: NoteBlock, style: NoteStyle): boolean =>
  style === 'code' && b.style !== 'code' && /<(h[1-3]|strong|b|em|i|u|s|ul|ol|li|blockquote|a|img|table|pre|code)\b/i.test(b.html);

/** The style after this one when cycling: text, sticky, code, text … */
export const nextStyle = (s: NoteStyle): NoteStyle => (s === 'text' ? 'sticky' : s === 'sticky' ? 'code' : 'text');

export const noteStyleLabel: Record<NoteStyle, string> = { text: 'Text', sticky: 'Sticky', code: 'Code' };

export const isNoteBlock = (b: Block): b is NoteBlock => b.type === 'note';
