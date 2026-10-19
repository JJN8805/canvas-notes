import { NOTE_COLORS, type Block, type NoteColor } from '../types';

export const isNoteColor = (c: unknown): c is NoteColor => (NOTE_COLORS as readonly string[]).includes(c as string);

/** CSS for a note colour's background and for the text that stays readable on it (see styles.css). */
export const noteVar = (c: NoteColor) => `var(--n-${c})`;
export const noteInk = (c: NoteColor) => `var(--n-${c}-ink)`;

/** A colour read from stored data: anything unknown (an older or newer app version) counts as none. */
export const cleanColor = (c: unknown): NoteColor | null => (isNoteColor(c) ? c : null);

/**
 * Colours the given boxes in place. A frame's colour is its header and outline, so it takes the colour
 * (or goes back to slate for "none"); every other box gets a tint. Returns whether anything changed.
 */
export function applyColor(blocks: Block[], ids: readonly string[], color: NoteColor | null): boolean {
  const want = new Set(ids);
  let changed = false;
  for (const b of blocks) {
    if (!want.has(b.id)) continue;
    if (b.type === 'frame') {
      const next = color ?? 'slate';
      if (b.color !== next) {
        b.color = next;
        changed = true;
      }
    } else if ((b.tint ?? null) !== color) {
      if (color) b.tint = color;
      else delete b.tint;
      changed = true;
    }
  }
  return changed;
}

/** The colour a box shows, or null for none. */
export function colorOf(b: Block): NoteColor | null {
  return b.type === 'frame' ? (isNoteColor(b.color) ? b.color : null) : cleanColor(b.tint);
}

/** The CSS variables a tinted box reads (`--tint` behind, `--tint-ink` for its text); none when it has no colour. */
export function tintVars(b: Block): Record<string, string> | undefined {
  const c = b.type === 'frame' ? null : cleanColor(b.tint);
  if (!c) return undefined;
  return {
    '--tint': noteVar(c),
    '--tint-ink': noteInk(c),
    // Quieter text (placeholders, finished items) and a slightly deeper shade (table header row), both from the same pair.
    '--tint-soft': `color-mix(in srgb, ${noteInk(c)} 72%, ${noteVar(c)})`,
    '--tint-head': `color-mix(in srgb, ${noteInk(c)} 12%, ${noteVar(c)})`,
  };
}

/** Text colour for a frame's header: readable on a note colour, or null to keep the usual white on the older frame colours. */
export const frameInk = (color: string): string | null => (isNoteColor(color) ? noteInk(color) : null);

/** The colour a new sticky starts with when none has been chosen yet. */
export const DEFAULT_STICKY_COLOR: NoteColor = 'yellow';

export const STICKY_SIZE = 200;

/** Plain "S" (no Ctrl, Alt or Shift) drops a sticky; the canvas only asks when no text field has focus. */
export const isStickyKey = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat?: boolean }) =>
  e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat;

/** Top-left corner for a sticky centred on a point, kept on the 8px grid and off negative coordinates. */
export const stickyCorner = (p: { x: number; y: number }, size = STICKY_SIZE) => ({
  x: Math.max(0, Math.round((p.x - size / 2) / 8) * 8),
  y: Math.max(0, Math.round((p.y - size / 2) / 8) * 8),
});

/**
 * Whether pressing on a sticky's text should drag the note instead of starting to type: only with a mouse or pen,
 * only when the note isn't already being edited, and not with Shift (which toggles selection). Double-click edits.
 */
export const dragsStickyBody = (o: { type: string; pointerType: string; shiftKey: boolean; editing: boolean; onText: boolean }) =>
  o.type === 'sticky' && o.pointerType !== 'touch' && !o.shiftKey && !o.editing && o.onText;
