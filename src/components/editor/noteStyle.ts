import type { NoteBlock, NoteStyle } from '../../types';
import { losesFormatting, nextStyle } from '../../lib/note';
import { setNoteStyles, useNotes } from '../../store/notes';
import { confirmDanger } from '../../store/ui';

const notesAmong = (pageId: string, ids: string[]): NoteBlock[] =>
  (useNotes.getState().pages[pageId]?.blocks ?? []).filter((b): b is NoteBlock => b.type === 'note' && ids.includes(b.id) && !b.locked);

/** Switch the notes among `ids` to a style, asking first when that would drop formatting (headings, bold, lists…). One undo step. */
export async function changeNoteStyle(pageId: string, ids: string[], style: NoteStyle): Promise<void> {
  const notes = notesAmong(pageId, ids);
  if (!notes.length) return;
  if (notes.some((n) => losesFormatting(n, style))) {
    const many = notes.filter((n) => losesFormatting(n, style)).length;
    const ok = await confirmDanger(
      many > 1 ? `Make ${many} notes code?` : 'Make this a code note?',
      'Code is plain text, so bold, headings, lists and links are dropped. You can undo this.',
      'Make code',
    );
    if (!ok) return;
  }
  setNoteStyles(pageId, ids, style);
}

/** Alt+N: move the selected notes on to the next style (text, sticky, code), judged by the first one. */
export function cycleNoteStyle(pageId: string, ids: string[]): Promise<void> {
  const first = notesAmong(pageId, ids)[0];
  return first ? changeNoteStyle(pageId, ids, nextStyle(first.style)) : Promise.resolve();
}
