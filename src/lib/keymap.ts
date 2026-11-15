/**
 * The one-letter keys on a page (S for a sticky, M for the map…) and the rules for changing them (pure).
 * Ctrl, Alt and Shift combinations are fixed; only these plain letters can be rebound, one letter per action, no sharing.
 */
export type KeyAction = 'sticky' | 'text' | 'checklist' | 'code' | 'table' | 'frame' | 'minimap' | 'hand';

export const KEY_ACTIONS: { id: KeyAction; label: string }[] = [
  { id: 'sticky', label: 'Sticky note' },
  { id: 'text', label: 'Text box' },
  { id: 'checklist', label: 'List' },
  { id: 'code', label: 'Code box' },
  { id: 'table', label: 'Table' },
  { id: 'frame', label: 'Frame' },
  { id: 'minimap', label: 'Show or hide the map' },
  { id: 'hand', label: 'Hand tool (drag to pan)' },
];

export type Keymap = Record<KeyAction, string>;

export const DEFAULT_KEYMAP: Keymap = { sticky: 'S', text: 'T', checklist: 'L', code: 'C', table: 'B', frame: 'F', minimap: 'M', hand: 'H' };

const isLetter = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z]$/.test(v);

/** A stored keymap, repaired: anything missing, not a letter, or already used by another action goes back to its default. */
export function cleanKeymap(v: unknown): Keymap {
  let raw: unknown = v;
  if (typeof v === 'string') {
    try {
      raw = JSON.parse(v);
    } catch {
      raw = null;
    }
  }
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_KEYMAP };
  const used = new Set<string>();
  for (const { id } of KEY_ACTIONS) {
    const wanted = isLetter(src[id]) ? (src[id] as string).toUpperCase() : DEFAULT_KEYMAP[id];
    // Its own letter if nobody has it yet, else its default, else the first letter still free.
    const pick = [wanted, DEFAULT_KEYMAP[id], ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find((c) => !used.has(c))!;
    out[id] = pick;
    used.add(pick);
  }
  return out;
}

export type SetKeyResult = { ok: true; map: Keymap } | { ok: false; error: string };

/** Gives `action` the letter `key`, or says why not (one letter only, and not one another action already has). */
export function setKey(map: Keymap, action: KeyAction, key: string): SetKeyResult {
  if (!isLetter(key)) return { ok: false, error: 'Use a letter from A to Z.' };
  const k = key.toUpperCase();
  const clash = KEY_ACTIONS.find((a) => a.id !== action && map[a.id] === k);
  if (clash) return { ok: false, error: `${k} already does “${clash.label}”. Change that one first.` };
  return { ok: true, map: { ...map, [action]: k } };
}

/** Which action a physical key press (KeyboardEvent.code, e.g. "KeyS") triggers. */
export function actionFor(map: Keymap, code: string): KeyAction | null {
  const m = /^Key([A-Z])$/.exec(code);
  if (!m) return null;
  return KEY_ACTIONS.find((a) => map[a.id] === m[1])?.id ?? null;
}

export const isDefaultKeymap = (map: Keymap) => KEY_ACTIONS.every((a) => map[a.id] === DEFAULT_KEYMAP[a.id]);
