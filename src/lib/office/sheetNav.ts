/** Moving around a spreadsheet and the clipboard text of cells (pure): where the cursor goes for each key, which rows to draw, tab-separated text. */
import { normRect, type Pos, type Rect } from './sheetModel';

export interface Sel {
  /** Where the selection started (the cell the cursor is "in" when it is one cell). */
  anchor: Pos;
  /** The other corner: the one that moves when the selection is extended. */
  focus: Pos;
}

export interface Bounds {
  rows: number;
  cols: number;
}

export const single = (p: Pos): Sel => ({ anchor: p, focus: p });
export const rectOf = (s: Sel): Rect => normRect(s.anchor, s.focus);
export const isSingle = (s: Sel) => s.anchor.r === s.focus.r && s.anchor.c === s.focus.c;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const clampPos = (p: Pos, b: Bounds): Pos => ({ r: clamp(p.r, 0, b.rows - 1), c: clamp(p.c, 0, b.cols - 1) });

export type Dir = 'up' | 'down' | 'left' | 'right';
const STEP: Record<Dir, Pos> = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } };

/**
 * An arrow key. Plain: the cursor moves one cell. Shift: the selection grows. `edge` (Ctrl/Cmd) jumps like a spreadsheet does: to the
 * end of the run of filled cells, or, from the end of a run, to the next filled cell, or to the edge of the sheet.
 */
export function move(s: Sel, dir: Dir, opts: { extend?: boolean; edge?: boolean; filled?: (p: Pos) => boolean; bounds: Bounds }): Sel {
  const { extend, edge, filled, bounds } = opts;
  const d = STEP[dir];
  const from = s.focus;
  let to = clampPos({ r: from.r + d.r, c: from.c + d.c }, bounds);
  if (edge) {
    const has = filled ?? (() => false);
    const next = (p: Pos) => clampPos({ r: p.r + d.r, c: p.c + d.c }, bounds);
    let cur = from;
    let nxt = next(cur);
    if (nxt.r === cur.r && nxt.c === cur.c) to = cur;
    else if (has(cur) && has(nxt)) {
      while (true) {
        const n2 = next(nxt);
        if ((n2.r === nxt.r && n2.c === nxt.c) || !has(n2)) break;
        nxt = n2;
      }
      to = nxt;
    } else {
      cur = nxt;
      while (!has(cur)) {
        const n2 = next(cur);
        if (n2.r === cur.r && n2.c === cur.c) break;
        cur = n2;
      }
      to = cur;
    }
  }
  return extend ? { anchor: s.anchor, focus: to } : single(to);
}

/** After typing into a cell: Enter goes down (Shift: up), Tab goes right (Shift: left), staying inside the sheet. */
export function afterCommit(s: Sel, how: 'enter' | 'shift-enter' | 'tab' | 'shift-tab', bounds: Bounds): Sel {
  const p = s.focus;
  const to = how === 'enter' ? { r: p.r + 1, c: p.c } : how === 'shift-enter' ? { r: p.r - 1, c: p.c } : how === 'tab' ? { r: p.r, c: p.c + 1 } : { r: p.r, c: p.c - 1 };
  return single(clampPos(to, bounds));
}

/** Which rows to draw for a scroll position: those in view plus a few more each side. */
export function visibleRows(scrollTop: number, viewHeight: number, rowHeight: number, total: number, overscan = 6): { from: number; to: number } {
  const from = Math.min(total, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  const to = Math.min(total, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan);
  return { from, to: Math.max(from, to) };
}

/** Cells as the text other programs use for a copied range: tabs between cells, a line break between rows (quoted when a cell needs it). */
export function toTsv(cells: string[][]): string {
  const q = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return cells.map((r) => r.map(q).join('\t')).join('\n');
}

/** The reverse: pasted text as rows of cells. A lone value is one cell; quotes may hold tabs and line breaks. */
export function fromTsv(text: string): string[][] {
  const t = text.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length || !rows.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
