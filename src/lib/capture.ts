/** Quick capture: a thought dropped into a workspace's Inbox page without opening that workspace. Pure: what the new note looks like and where it goes. */
import type { Block, NoteBlock } from '../types';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE } from './colors';
import { newId, textToHtml } from './util';

export const INBOX_TITLE = 'Inbox';
const GAP = 20;
const MAX_CAPTURE = 2000;

/** What was typed, trimmed and cut to a sensible length ('' = nothing to add). */
export const cleanCapture = (text: unknown): string => (typeof text === 'string' ? text.trim().slice(0, MAX_CAPTURE) : '');

/** A sticky note holding the text, placed in a column under the boxes the Inbox already has (so notes never land on top of each other). */
export function captureBlock(existing: readonly Block[], text: string, newestOnTop = false): NoteBlock {
  const z = existing.reduce((m, b) => Math.max(m, b.z), 0) + 1;
  const bottom = existing.reduce((m, b) => Math.max(m, b.y + b.h), -GAP);
  return { id: newId(), type: 'note', style: 'sticky', x: 0, y: newestOnTop ? 0 : bottom + GAP, w: STICKY_SIZE, h: STICKY_SIZE, z, html: textToHtml(cleanCapture(text)), tint: DEFAULT_STICKY_COLOR };
}
