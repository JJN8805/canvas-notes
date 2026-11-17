import type { Block, ChecklistBlock, NoteBlock } from '../types';
import { htmlToText, newId } from './util';

/** What a note's text turns into when it becomes a list or table (Notion's "Turn into"): one entry per non-empty line. */
export function noteLines(b: NoteBlock): string[] {
  const text = b.style === 'code' ? (b.code ?? '') : htmlToText(b.html);
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 200);
}

/** The fields a box keeps when it changes into another kind: where it is, its colour, its links… (everything but what only a note has). */
const NOTE_ONLY = new Set(['type', 'style', 'html', 'code', 'fill', 'doc', 'h']);

/** The same box as a checklist: same place, id, width, colour, lock and links; each line of the note is an item. Returns null for anything but a note. */
export function noteToChecklist(b: Block): ChecklistBlock | null {
  if (b.type !== 'note') return null;
  const keep: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) if (!NOTE_ONLY.has(k)) keep[k] = v;
  const lines = noteLines(b);
  return { ...keep, type: 'checklist', h: 48, items: (lines.length ? lines : ['']).map((text) => ({ id: newId(), text, done: false })) } as unknown as ChecklistBlock;
}
