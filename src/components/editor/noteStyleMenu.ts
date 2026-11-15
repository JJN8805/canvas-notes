import type { Block } from '../../types';
import { NOTE_STYLES } from '../../types';
import { noteStyleLabel } from '../../lib/note';
import type { MenuItem } from '../../store/ui';
import { changeNoteStyle } from './noteStyle';

/** "Note style" entries for the box menu when the selection holds notes: a tick shows the style they all share. Empty otherwise. */
export function noteStyleMenu(pageId: string, blocks: Block[], ids: string[]): MenuItem[] {
  const notes = blocks.filter((b) => ids.includes(b.id) && b.type === 'note');
  if (!notes.length) return [];
  const styles = new Set(notes.map((n) => (n.type === 'note' ? n.style : '')));
  return [
    { separator: true },
    { heading: notes.length > 1 ? `Note style (${notes.length})` : 'Note style' },
    ...NOTE_STYLES.map((s) => ({ label: noteStyleLabel[s], check: styles.size === 1 && styles.has(s), action: () => void changeNoteStyle(pageId, ids, s) })),
  ];
}
