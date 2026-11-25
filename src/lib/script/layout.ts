/**
 * Setting a script on paper (pure). One layout serves the page counter, the on-screen page breaks, the text export and the PDF, so they
 * always agree: elements become lines of monospace text with a column, lines are gathered into pages, and a long speech may be split
 * across a page with (MORE) and (CONT'D) the way a printed screenplay does.
 */
import { characterName } from './fountain';
import { FORMATS, type ElType, type ScriptEl, type ScriptFormat } from './model';

export interface PrintLine {
  /** Characters from the left margin. */
  col: number;
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** The element this line came from. */
  el: number;
  /** A second piece of text on the same line (the sound column of a two-column script). */
  right?: { col: number; text: string; bold?: boolean; italic?: boolean };
}
export interface PrintPage {
  number: number;
  lines: PrintLine[];
}

/** Greedy word wrap to `width` characters; hard line breaks are kept. */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(4, Math.floor(width));
  const out: string[] = [];
  for (const hard of text.split('\n')) {
    let line = '';
    for (const word of hard.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > w) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(rest.slice(0, w));
        rest = rest.slice(w);
      }
      if (!line) line = rest;
      else if (line.length + 1 + rest.length <= w) line += ' ' + rest;
      else {
        out.push(line);
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}

const place = (text: string, indent: number, width: number, align: 'left' | 'center' | 'right' = 'left') =>
  align === 'center' ? indent + Math.max(0, Math.floor((width - text.length) / 2)) : align === 'right' ? indent + Math.max(0, width - text.length) : indent;

interface Unit {
  /** Element index. */
  el: number;
  type: ElType;
  before: number;
  lines: PrintLine[];
  /** Name of the speaker, for (CONT'D). */
  speaker?: string;
}

/** Every printable element as its lines, with the blank space above it. Pure and independent of pages. */
function toUnits(els: readonly ScriptEl[], format: ScriptFormat): Unit[] {
  const f = FORMATS[format];
  const units: Unit[] = [];
  let speaker = '';
  els.forEach((e, el) => {
    const st = f.styles[e.type];
    if (st.hidden || e.type === 'pagebreak') return;
    if (!e.text.trim()) return;
    let text = e.text;
    if (st.upper) text = text.toUpperCase();
    if (e.type === 'parenthetical') text = `(${text.replace(/^\(/, '').replace(/\)$/, '')})`;
    if (format === 'audio' && e.type === 'action') text = `[${text.replace(/^\[/, '').replace(/\]$/, '')}]`;
    if (format === 'manuscript' && e.type === 'centered' && !text.trim()) text = '#';
    if (e.type === 'character') speaker = characterName(e.text);
    const first = st.first ?? 0;
    const lines: PrintLine[] = [];
    const wrapped = wrap('x'.repeat(first) + text, st.width);
    if (first) wrapped[0] = ' '.repeat(first) + wrapped[0].slice(first);
    wrapped.forEach((t) => {
      const aligned = !!st.align && st.align !== 'left';
      const col = aligned ? place(t.trim(), st.indent, st.width, st.align) : st.indent;
      lines.push({ col, text: aligned ? t.trim() : t, bold: st.bold, italic: st.italic, el });
      if (f.step === 2) lines.push({ col, text: '', el });
    });
    units.push({ el, type: e.type, before: st.before, lines, speaker: e.type === 'dialogue' || e.type === 'parenthetical' ? speaker : undefined });
  });
  return units;
}

/** The two-column format: consecutive picture elements and consecutive sound elements are set side by side as one row. */
function toRows(units: Unit[]): Unit[] {
  const rows: Unit[] = [];
  const audio = (t: ElType) => t === 'character' || t === 'dialogue' || t === 'parenthetical';
  let cur: { left: Unit[]; right: Unit[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const left = cur.left.flatMap((u, k) => [...(k && u.before ? [{ col: 0, text: '', el: u.el }] : []), ...u.lines]);
    const right = cur.right.flatMap((u, k) => [...(k && u.before ? [{ col: 0, text: '', el: u.el }] : []), ...u.lines]);
    const n = Math.max(left.length, right.length);
    const lines: PrintLine[] = [];
    for (let i = 0; i < n; i++) {
      const l = left[i];
      const r = right[i];
      lines.push({ ...(l ?? { col: 0, text: '', el: r.el }), ...(r?.text ? { right: { col: r.col, text: r.text, bold: r.bold, italic: r.italic } } : {}) });
    }
    rows.push({ el: (cur.left[0] ?? cur.right[0]).el, type: 'action', before: cur.left[0]?.before ?? cur.right[0]?.before ?? 1, lines });
    cur = null;
  };
  for (const u of units) {
    if (u.type === 'transition' || u.type === 'centered') {
      flush();
      rows.push(u);
      continue;
    }
    if (audio(u.type)) {
      cur = cur ?? { left: [], right: [] };
      cur.right.push(u);
    } else {
      if (cur && cur.right.length) flush();
      cur = cur ?? { left: [], right: [] };
      cur.left.push(u);
    }
  }
  flush();
  return rows;
}

/** The printed pages of a script. */
export function layoutPages(els: readonly ScriptEl[], format: ScriptFormat): PrintPage[] {
  const f = FORMATS[format];
  const P = f.pageLines;
  let units = toUnits(els, format);
  if (f.columns) units = toRows(units);
  const pages: PrintPage[] = [{ number: 1, lines: [] }];
  let used = 0;
  const cur = () => pages[pages.length - 1];
  const newPage = () => {
    pages.push({ number: pages.length + 1, lines: [] });
    used = 0;
  };
  const blank = (el: number): PrintLine => ({ col: 0, text: '', el });

  units.forEach((u, idx) => {
    const forced = els.slice((units[idx - 1]?.el ?? -1) + 1, u.el).some((e) => e.type === 'pagebreak');
    if (forced && used > 0) newPage();
    const top = used === 0;
    const gap = top ? 0 : u.before;
    const need = gap + u.lines.length;
    const next = units[idx + 1];
    // headings and cues stay with what follows
    const keep = (u.type === 'scene' || u.type === 'character' || u.type === 'parenthetical') && next ? Math.min(2, next.lines.length) : 0;
    if (used + need + keep <= P || (top && need > P)) {
      for (let i = 0; i < gap; i++) cur().lines.push(blank(u.el));
      cur().lines.push(...u.lines);
      used += need;
      return;
    }
    const room = P - used - gap;
    const splittable = (u.type === 'dialogue' || u.type === 'action') && u.lines.length >= 6 && room >= 3;
    if (splittable) {
      const more = u.type === 'dialogue' && !f.columns && f.step === 1;
      let lines = u.lines;
      let g = gap;
      for (let guard = 0; guard < 1000; guard++) {
        const r = P - used - g;
        if (lines.length <= r) break;
        const take = Math.min(more ? r - 1 : r, lines.length - 2);
        if (take < 2) {
          newPage();
          g = 0;
          continue;
        }
        for (let i = 0; i < g; i++) cur().lines.push(blank(u.el));
        cur().lines.push(...lines.slice(0, take));
        if (more) cur().lines.push({ col: f.styles.character.indent, text: '(MORE)', el: u.el });
        newPage();
        g = 0;
        if (more && u.speaker) {
          cur().lines.push({ col: f.styles.character.indent, text: `${u.speaker} (CONT'D)`, el: u.el });
          used += 1;
        }
        lines = lines.slice(take);
      }
      for (let i = 0; i < g; i++) cur().lines.push(blank(u.el));
      cur().lines.push(...lines);
      used += g + lines.length;
      return;
    }
    newPage();
    cur().lines.push(...u.lines);
    used += u.lines.length;
  });
  return pages;
}

/** The page on which each element starts (1-based), for page markers and the scene list. Hidden elements get the page they sit on. */
export function pageOfElements(els: readonly ScriptEl[], format: ScriptFormat): number[] {
  const pages = layoutPages(els, format);
  const at: number[] = new Array(els.length).fill(0);
  for (const p of pages) for (const l of p.lines) if (l.el >= 0 && !at[l.el]) at[l.el] = p.number;
  let last = 1;
  const filled = at.map((n) => (n ? (last = n) : last));
  // a page break belongs to the page it starts
  for (let i = filled.length - 1; i >= 0; i--) if (els[i].type === 'pagebreak' && i + 1 < filled.length) filled[i] = filled[i + 1];
  return filled;
}
