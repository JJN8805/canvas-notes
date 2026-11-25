/**
 * Fountain <-> elements (pure). Fountain is the plain-text script markup (fountain.io) that Highland, Fade In, Trelby, WriterDuet, Celtx and
 * others read and write, so a script made here opens anywhere and one written elsewhere opens here. This is the useful core of the
 * spec: title page, scene headings, action, character / dialogue / parenthetical, transitions, centred text, sections, synopses,
 * page breaks, forced elements and dual dialogue. `serializeScript` always writes text that `parseScript` reads back as the same elements.
 */
import type { ElType, ScriptDoc, ScriptEl } from './model';

const SCENE_RE = /^(?:INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E)(?:\.| )/i;
const TITLE_KEYS = ['title', 'credit', 'author', 'authors', 'source', 'draft date', 'date', 'contact', 'copyright', 'notes', 'revision', 'format'];
const KEY_RE = /^([A-Za-z][A-Za-z ]*?):\s*(.*)$/;

export const isSceneHeading = (t: string): boolean => SCENE_RE.test(t.trim());
export const isTransitionText = (t: string): boolean => /^[^a-z]*[A-Z][^a-z]*TO:$/.test(t.trim());

/** The name in a character cue without `(V.O.)`, `(CONT'D)` or the dual-dialogue mark. */
export const characterName = (cue: string): string => cue.replace(/\^\s*$/, '').replace(/(?:\s*\([^)]*\))+\s*$/, '').trim().toUpperCase();

function isCharacterLine(line: string): boolean {
  const t = line.trim().replace(/\^$/, '');
  if (!t || /^[#=.>~!\[(]/.test(t) && !/^@/.test(t)) return false;
  const base = t.replace(/\s*\([^)]*\)\s*$/, '');
  return base.length > 0 && /[A-Z]/.test(base) && base === base.toUpperCase() && !isSceneHeading(base);
}

function stripBoneyard(text: string): string {
  return text.replace(/\/\*[\s\S]*?(\*\/|$)/g, '');
}

function parseTitle(lines: string[]): { meta: [string, string][]; used: number } {
  const meta: [string, string][] = [];
  let i = 0;
  const first = KEY_RE.exec(lines[0] ?? '');
  if (!first || !TITLE_KEYS.includes(first[1].toLowerCase())) return { meta, used: 0 };
  for (; i < lines.length && lines[i].trim() !== ''; i++) {
    const line = lines[i];
    if (/^(?: {3,}|\t)/.test(line) && meta.length) {
      const last = meta[meta.length - 1];
      last[1] = last[1] ? `${last[1]}\n${line.trim()}` : line.trim();
      continue;
    }
    const m = KEY_RE.exec(line);
    if (!m) break;
    meta.push([m[1].trim(), m[2].trim()]);
  }
  return { meta, used: i };
}

export function parseScript(source: string): ScriptDoc {
  const lines = stripBoneyard(source.replace(/\r\n?/g, '\n')).split('\n');
  const { meta, used } = parseTitle(lines);
  const els: ScriptEl[] = [];
  let i = used;
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') block.push(lines[i++]);
    readBlock(block, els);
  }
  return { meta, els };
}

function readBlock(block: string[], out: ScriptEl[]) {
  const head = block[0].trim();
  if (/^={3,}$/.test(head) && block.length === 1) return void out.push({ type: 'pagebreak', text: '' });
  if (/^#+\s/.test(head) || /^#+$/.test(head)) {
    const level = (head.match(/^#+/) as RegExpMatchArray)[0].length;
    out.push({ type: 'section', text: head.slice(level).trim(), level });
    return rest(block.slice(1), out);
  }
  if (/^=(?!=)/.test(head)) {
    out.push({ type: 'synopsis', text: head.replace(/^=\s*/, '') });
    return rest(block.slice(1), out);
  }
  if (/^>.*<$/.test(head)) {
    out.push({ type: 'centered', text: head.replace(/^>\s*/, '').replace(/\s*<$/, '') });
    return rest(block.slice(1), out);
  }
  if (/^>/.test(head)) {
    out.push({ type: 'transition', text: head.replace(/^>\s*/, '') });
    return rest(block.slice(1), out);
  }
  if (/^\.(?!\.)/.test(head) || isSceneHeading(head)) {
    out.push({ type: 'scene', text: head.replace(/^\./, '').replace(/\s*#[^#]*#\s*$/, '').trim().toUpperCase() });
    return rest(block.slice(1), out);
  }
  if (block.length === 1 && isTransitionText(head)) return void out.push({ type: 'transition', text: head });
  if (/^@/.test(head) || (block.length > 1 && isCharacterLine(head) && !/^!/.test(head))) {
    const dual = /\^\s*$/.test(head);
    out.push({ type: 'character', text: head.replace(/^@/, '').replace(/\s*\^\s*$/, '').trim(), ...(dual ? { dual: true } : {}) });
    return void dialogue(block.slice(1), out);
  }
  out.push({ type: 'action', text: block.map((l, k) => (k === 0 ? l.replace(/^!/, '') : l).replace(/\s+$/, '')).join('\n') });
}

/** What follows a heading-like first line in the same block is read on its own (a heading without a blank line after it). */
function rest(more: string[], out: ScriptEl[]) {
  if (more.length) readBlock(more, out);
}

function dialogue(lines: string[], out: ScriptEl[]) {
  let speech: string[] = [];
  const flush = () => {
    if (speech.length) out.push({ type: 'dialogue', text: speech.join('\n') });
    speech = [];
  };
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '');
    if (/^\(.*\)$/.test(l.trim()) && !speech.length) {
      out.push({ type: 'parenthetical', text: l.trim().slice(1, -1) });
    } else if (/^\(.*\)$/.test(l.trim())) {
      flush();
      out.push({ type: 'parenthetical', text: l.trim().slice(1, -1) });
    } else speech.push(l);
  }
  flush();
}

/* ---------------- writing ---------------- */

const readsAs = (text: string, type: ElType): boolean => {
  const doc = parseScript(text);
  return doc.els.length === 1 && doc.els[0].type === type && doc.els[0].text === text;
};

/** One element in Fountain, forced with `!`, `@`, `.` or `>` only when plain text would be read as something else. */
export function writeElement(e: ScriptEl): string {
  const t = e.text.replace(/\r/g, '');
  switch (e.type) {
    case 'scene': {
      const up = t.trim().toUpperCase().replace(/\n+/g, ' ');
      return isSceneHeading(up) ? up : `.${up}`;
    }
    case 'action': {
      const body = t.split('\n').map((l) => (l.trim() === '' ? '  ' : l)).join('\n');
      return readsAs(body, 'action') && !/^\s/.test(body) ? body : `!${body}`;
    }
    case 'character': {
      const name = t.trim().replace(/\s+/g, ' ');
      const up = name.toUpperCase();
      const plain = `${up}\nx`;
      const d = parseScript(plain);
      const ok = d.els[0]?.type === 'character' && d.els[0].text === up;
      return (ok ? up : `@${name}`) + (e.dual ? ' ^' : '');
    }
    case 'dialogue':
      return t.split('\n').map((l) => (l.trim() === '' ? '  ' : l)).join('\n');
    case 'parenthetical':
      return `(${t.trim().replace(/^\(/, '').replace(/\)$/, '')})`;
    case 'transition': {
      const up = t.trim().toUpperCase();
      return isTransitionText(up) ? up : `> ${up}`;
    }
    case 'centered':
      return `> ${t.trim()} <`;
    case 'section':
      return `${'#'.repeat(Math.max(1, Math.min(6, e.level ?? 1)))} ${t.trim()}`;
    case 'synopsis':
      return `= ${t.trim().replace(/\n+/g, ' ')}`;
    case 'pagebreak':
      return '===';
  }
}

const isEmpty = (e: ScriptEl) => e.type !== 'pagebreak' && e.text.trim() === '' && e.type !== 'section';

/** The title page and elements as Fountain text. Empty elements are left out. */
export function serializeScript(doc: ScriptDoc): string {
  const parts: string[] = [];
  const meta = doc.meta.filter(([k]) => k.trim());
  if (meta.length) {
    parts.push(
      meta
        .map(([k, v]) => (v.includes('\n') ? `${k}:\n${v.split('\n').map((l) => `   ${l}`).join('\n')}` : `${k}: ${v}`))
        .join('\n'),
    );
  }
  // A cue with no speech after it would read back as action: leave it out. Speech and parentheticals follow their cue without a blank line.
  const kept = doc.els.filter((e, i) => {
    if (isEmpty(e)) return false;
    if (e.type === 'character') {
      const n = doc.els[i + 1];
      return !!n && (n.type === 'dialogue' || n.type === 'parenthetical') && !isEmpty(n);
    }
    return true;
  });
  let text = '';
  kept.forEach((e, i) => {
    const prev = kept[i - 1];
    const joined = prev && (e.type === 'dialogue' || e.type === 'parenthetical') && (prev.type === 'character' || prev.type === 'parenthetical' || prev.type === 'dialogue');
    text += (!prev ? '' : joined ? '\n' : '\n\n') + writeElement(e);
  });
  if (text) parts.push(text);
  return parts.join('\n\n') + (parts.length ? '\n' : '');
}

/** An empty script. */
export const emptyDoc = (): ScriptDoc => ({ meta: [], els: [{ type: 'action', text: '' }] });

export const metaValue = (doc: ScriptDoc, key: string): string => doc.meta.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] ?? '';
export function setMeta(doc: ScriptDoc, key: string, value: string): ScriptDoc {
  const at = doc.meta.findIndex(([k]) => k.toLowerCase() === key.toLowerCase());
  const meta = doc.meta.map((m) => [...m] as [string, string]);
  if (!value.trim()) return { ...doc, meta: meta.filter((_, i) => i !== at) };
  if (at >= 0) meta[at][1] = value;
  else meta.push([key, value]);
  return { ...doc, meta };
}
