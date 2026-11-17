import type { Draft } from 'immer';
import type { Block } from '../types';
import { mutatePage } from './notes';
import { setNoteStyleOf } from './notes/blocks';
import { noteToChecklist } from '../lib/turnInto';
import { useNotes } from './notes';

export type TurnKind = 'text' | 'sticky' | 'code' | 'checklist';

/** Change a note into another kind, keeping its words (one undo step). Returns false when the box cannot be changed. */
export function turnNoteInto(pageId: string, blockId: string, kind: TurnKind): boolean {
  const b = useNotes.getState().pages[pageId]?.blocks.find((x) => x.id === blockId);
  if (!b || b.type !== 'note' || b.locked) return false;
  if (kind !== 'checklist') {
    setNoteStyleOf(pageId, blockId, kind);
    return true;
  }
  const next = noteToChecklist(b);
  if (!next) return false;
  mutatePage(pageId, (p) => {
    const i = p.blocks.findIndex((x) => x.id === blockId);
    if (i >= 0) p.blocks[i] = next as unknown as Draft<Block>;
  });
  return true;
}
