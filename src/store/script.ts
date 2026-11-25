/** Actions on a script page: the stored text and the layout. Every change goes through `updateBlock`, so undo and sync work as for any box. */
import { scriptBlock } from '../lib/office/app';
import { isScriptFormat, type ScriptFormat } from '../lib/script/model';
import { useNotes } from './notes';
import { updateBlock } from './notes/mutate';
import type { NoteBlock } from '../types';

export const scriptOf = (pageId: string): NoteBlock | undefined => scriptBlock(useNotes.getState().pages[pageId]?.blocks ?? []);

/** Replaces the script's text. `key` joins consecutive edits of one kind (typing) into one undo step. */
export function writeScript(pageId: string, text: string, key?: string) {
  const b = scriptOf(pageId);
  if (!b || b.code === text) return;
  updateBlock<NoteBlock>(pageId, b.id, (n) => void (n.code = text), key ? { history: { key } } : undefined);
}

export function setScriptFormat(pageId: string, format: ScriptFormat) {
  const b = scriptOf(pageId);
  if (!b || !isScriptFormat(format) || b.script?.format === format) return;
  updateBlock<NoteBlock>(pageId, b.id, (n) => void (n.script = { page: true, format }));
}
