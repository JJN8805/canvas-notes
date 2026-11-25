/**
 * Editing a script (pure): which element follows Enter, what Tab turns a row into, completions, and moving whole scenes. The editor
 * only calls these, so the rules can be tested without a screen. They follow what Final Draft and Fade In do: Enter on a cue goes to
 * dialogue, Enter after dialogue goes to action, Tab walks the element types.
 */
import { characterName, isSceneHeading, isTransitionText } from './fountain';
import { FORMATS, type ElType, type ScriptEl, type ScriptFormat } from './model';

/** The type of the row Enter creates after one of this type. */
export function nextAfter(type: ElType, format: ScriptFormat): ElType {
  switch (type) {
    case 'character':
    case 'parenthetical':
      return 'dialogue';
    case 'transition':
      return format === 'manuscript' ? 'action' : 'scene';
    case 'scene':
      return format === 'stage' || format === 'audio' ? 'character' : 'action';
    case 'section':
    case 'synopsis':
    case 'centered':
    case 'dialogue':
    default:
      return 'action';
  }
}

/** Tab (or Shift+Tab) on a row: the next type the format offers, wrapping around. */
export function cycleType(type: ElType, format: ScriptFormat, back = false): ElType {
  const list: ElType[] = FORMATS[format].types.filter((t) => t !== 'section' && t !== 'synopsis');
  const i = list.indexOf(type);
  if (i < 0) return list[0];
  return list[(i + (back ? list.length - 1 : 1)) % list.length];
}

/** Typing "INT. " in an action row, or a line ending in "TO:", turns it into what it plainly is; anything else stays. */
export function detectType(type: ElType, text: string, format: ScriptFormat): ElType {
  if (type !== 'action' || format === 'manuscript') return type;
  const t = text.trim();
  if (!t.includes('\n')) {
    if (isSceneHeading(t) && /^(INT|EXT|EST|I\/E)/i.test(t)) return 'scene';
    if (isTransitionText(t)) return 'transition';
  }
  return type;
}

const TIMES = ['DAY', 'NIGHT', 'MORNING', 'EVENING', 'DAWN', 'DUSK', 'LATER', 'CONTINUOUS', 'MOMENTS LATER'];
const PLACE_PREFIX = ['INT. ', 'EXT. ', 'INT./EXT. '];
const TRANSITIONS = ['CUT TO:', 'FADE OUT.', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'FADE IN:', 'FADE TO BLACK.'];

/** Completions for the row at `index`: whole replacements for its text, best first, never the text it already is. */
export function suggest(els: readonly ScriptEl[], index: number): string[] {
  const e = els[index];
  if (!e) return [];
  const raw = e.text;
  const up = raw.trim().toUpperCase();
  let out: string[] = [];
  if (e.type === 'scene') {
    const dash = up.lastIndexOf(' - ');
    if (dash >= 0) {
      const head = raw.trim().slice(0, dash + 3);
      out = TIMES.filter((t) => t.startsWith(up.slice(dash + 3))).map((t) => head + t);
    } else if (!up || PLACE_PREFIX.some((p) => p.startsWith(up) && up.length < p.length)) {
      out = PLACE_PREFIX.filter((p) => p.startsWith(up));
    } else {
      const places = new Set<string>();
      els.forEach((o, i) => {
        if (o.type !== 'scene' || i === index) return;
        const place = o.text.trim().toUpperCase().split(' - ')[0];
        if (place.startsWith(up) && place !== up) places.add(place);
      });
      out = [...places].slice(0, 6);
    }
  } else if (e.type === 'character') {
    const counts = new Map<string, number>();
    els.forEach((o, i) => {
      if (o.type === 'character' && i !== index && o.text.trim()) counts.set(o.text.trim().toUpperCase(), (counts.get(o.text.trim().toUpperCase()) ?? 0) + 1);
    });
    out = [...counts.entries()].filter(([name]) => name.startsWith(up) && name !== up).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
    // A name with (CONT'D) / (V.O.) typed after it is left alone.
  } else if (e.type === 'transition') {
    out = TRANSITIONS.filter((t) => t.startsWith(up) && t !== up);
  }
  return out.filter((s) => s.toUpperCase() !== up).slice(0, 6);
}

/** Every distinct character name used so far, most frequent first (for a name picker). */
export function characterNames(els: readonly ScriptEl[]): string[] {
  const counts = new Map<string, number>();
  for (const e of els) if (e.type === 'character' && e.text.trim()) counts.set(characterName(e.text), (counts.get(characterName(e.text)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
}

/** Move the scene that starts at `index` (up to the next scene or outline heading) one scene earlier or later. Returns the new list and where the scene now starts. */
export function moveScene(els: readonly ScriptEl[], index: number, dir: -1 | 1): { els: ScriptEl[]; index: number } {
  const bounds = els.map((e, i) => (e.type === 'scene' || e.type === 'section' ? i : -1)).filter((i) => i >= 0);
  const at = bounds.indexOf(index);
  if (at < 0 || els[index].type !== 'scene') return { els: [...els], index };
  const end = bounds[at + 1] ?? els.length;
  if (dir === 1) {
    const nxt = bounds[at + 1];
    if (nxt === undefined || els[nxt].type !== 'scene') return { els: [...els], index };
    const nxtEnd = bounds[at + 2] ?? els.length;
    const out = [...els.slice(0, index), ...els.slice(nxt, nxtEnd), ...els.slice(index, end), ...els.slice(nxtEnd)];
    return { els: out, index: index + (nxtEnd - nxt) };
  }
  const prev = bounds[at - 1];
  if (prev === undefined || els[prev].type !== 'scene') return { els: [...els], index };
  const out = [...els.slice(0, prev), ...els.slice(index, end), ...els.slice(prev, index), ...els.slice(end)];
  return { els: out, index: prev };
}

/** The element indexes of one scene, heading included. */
export const sceneRange = (els: readonly ScriptEl[], index: number): [number, number] => {
  let end = index + 1;
  while (end < els.length && els[end].type !== 'scene' && els[end].type !== 'section') end++;
  return [index, end];
};

/** Every cue of one character renamed (extensions like (V.O.) stay). Returns the new list and how many cues changed. */
export function renameCharacter(els: readonly ScriptEl[], from: string, to: string): { els: ScriptEl[]; changed: number } {
  const old = characterName(from);
  const name = to.trim().toUpperCase();
  let changed = 0;
  if (!name || name === old) return { els: [...els], changed };
  const out = els.map((e) => {
    if (e.type !== 'character' || characterName(e.text) !== old) return e;
    changed++;
    const ext = /(\s*\([^)]*\))+\s*\^?\s*$/.exec(e.text)?.[0].replace(/\^\s*$/, '').trimEnd() ?? '';
    return { ...e, text: name + ext };
  });
  return { els: out, changed };
}

/** Sets (or clears) the note right under a scene heading. */
export function setSynopsis(els: readonly ScriptEl[], sceneIndex: number, text: string): ScriptEl[] {
  const out = [...els];
  const has = out[sceneIndex + 1]?.type === 'synopsis';
  if (has && text.trim()) out[sceneIndex + 1] = { ...out[sceneIndex + 1], text };
  else if (has) out.splice(sceneIndex + 1, 1);
  else if (text.trim()) out.splice(sceneIndex + 1, 0, { type: 'synopsis', text });
  return out;
}
