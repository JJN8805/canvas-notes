/** The inline AI card's target, and what accepting an answer does to the page. */
import { create } from 'zustand';
import type { Editor } from '@tiptap/react';
import { addBlock } from '../../store/notes';
import { canvasApi, setSelected } from '../../store/canvas';
import { newId } from '../../lib/util';
import { checklistItems } from './markdown';
import { inlineContent, resultToHtml } from './tasks';

export interface InlineTarget {
  /** Changes every time the card is opened, so each opening starts fresh. */
  id: number;
  /** `edit`: change the selected text (or the whole text box). `write`: write something new. */
  mode: 'edit' | 'write';
  /** The text box it came from. It can be gone (deleted, or the page closed) by the time an answer arrives. */
  editor: Editor | null;
  /** The range being edited (`edit`), or the whole text box when nothing was selected. */
  from: number;
  to: number;
  original: string;
  /** Nothing was selected: the whole text box is the text. */
  whole: boolean;
  /** The page the card was opened on. The card closes when you leave it. */
  pageId: string | null;
}

export const useInlineAi = create<{ target: InlineTarget | null }>(() => ({ target: null }));
/** Closes the card and gives the keyboard back to the text box it came from, so typing can carry on. */
export function closeInlineAi() {
  const t = useInlineAi.getState().target;
  useInlineAi.setState({ target: null });
  if (t?.editor && !t.editor.isDestroyed) t.editor.commands.focus();
}

let seq = 0;

/** The text of a range, with a blank line between paragraphs. */
const textOf = (editor: Editor, from: number, to: number) => editor.state.doc.textBetween(from, to, '\n\n', '\n');

/**
 * Opens the card on a text box. With text selected (or any text in the box) it edits that; in an empty box, or with
 * `forceWrite`, it writes something new.
 */
export function openInlineAi(editor: Editor | null, pageId: string | null, forceWrite = false) {
  let target: InlineTarget = { id: ++seq, mode: 'write', editor, from: 0, to: 0, original: '', whole: false, pageId };
  if (editor && !editor.isDestroyed && !forceWrite) {
    const { from, to } = editor.state.selection;
    const whole = from === to;
    const range = whole ? { from: 0, to: editor.state.doc.content.size } : { from, to };
    const original = textOf(editor, range.from, range.to).trim();
    if (original) target = { ...target, mode: 'edit', ...range, original, whole };
  }
  useInlineAi.setState({ target });
}

export type Placement = 'replace' | 'below';

export interface ApplyResult {
  ok: boolean;
  /** Why it didn't happen, in words for the user. */
  problem?: string;
}

/** Puts an answer into the text box it came from: in place of the text, or after it. */
export function applyToEditor(t: InlineTarget, answer: string, where: Placement): ApplyResult {
  const ed = t.editor;
  if (!ed || ed.isDestroyed) return { ok: false, problem: 'That text box is gone. Use “Insert as a new box” instead.' };
  const { html, inline } = resultToHtml(answer);
  if (!html) return { ok: false, problem: 'There is nothing to insert.' };
  if (where === 'replace') {
    // The text may have been edited while the answer was being written: replace only if it is still what was sent.
    if (textOf(ed, t.from, Math.min(t.to, ed.state.doc.content.size)).trim() !== t.original) return { ok: false, problem: 'The text changed while the answer was being written. Use “Insert below” instead.' };
    if (t.whole) ed.chain().focus().setContent(html, { emitUpdate: true }).run();
    else ed.chain().focus().insertContentAt({ from: t.from, to: t.to }, inline === null ? html : inlineContent(inline)).run();
    return { ok: true };
  }
  const doc = ed.state.doc;
  const at = t.whole || t.to >= doc.content.size ? doc.content.size : doc.resolve(t.to).depth >= 1 ? doc.resolve(t.to).after(1) : t.to;
  ed.chain().focus().insertContentAt(at, html).run();
  return { ok: true };
}

/** Writes an answer into the empty text box that asked, or into a new text box on the page. */
export function insertWritten(t: InlineTarget, answer: string): ApplyResult {
  const { html } = resultToHtml(answer);
  if (!html) return { ok: false, problem: 'There is nothing to insert.' };
  const ed = t.editor;
  if (ed && !ed.isDestroyed && ed.state.doc.textContent === '') {
    ed.chain().focus().setContent(html, { emitUpdate: true }).run();
    return { ok: true };
  }
  return insertAsBox(t, answer);
}

/** Puts an answer on the page as a new text box. */
export function insertAsBox(t: InlineTarget, answer: string): ApplyResult {
  if (!t.pageId) return { ok: false, problem: 'Open a page first.' };
  const { html } = resultToHtml(answer);
  const id = addBlock(t.pageId, 'text', canvasApi.current?.visibleSpot(420, 80) ?? { x: 120, y: 120 }, { html, w: 420 });
  if (id) setSelected([id]);
  return { ok: !!id };
}

/** Puts the "- [ ] task" lines of an answer on the page as a checklist box. */
export function insertAsChecklist(t: InlineTarget, answer: string): ApplyResult {
  const items = checklistItems(answer);
  if (!t.pageId || !items.length) return { ok: false, problem: 'There are no tasks to put in a checklist.' };
  const id = addBlock(t.pageId, 'checklist', canvasApi.current?.visibleSpot(300, 80) ?? { x: 120, y: 120 }, { items: items.map((text) => ({ id: newId(), text, done: false })) });
  if (id) setSelected([id]);
  return { ok: !!id };
}
