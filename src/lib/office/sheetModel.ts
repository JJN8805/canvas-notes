/**
 * Everything a spreadsheet does with its cells, as pure functions over `{ rows, fmt, colW }`: work out values, show them with a format,
 * insert and delete rows and columns (formulas follow), sort, fill, paste, read and write CSV. The grid on screen only calls these.
 */
import type { CellFormat } from '../../types';
import { cellName, colName, deleteRefs, err, evaluate, insertRefs, isErr, isFormula, literalValue, numberText, parseFormula, serialToDate, shiftFormula, type EvalCtx, type Val } from './formula';

export const MAX_ROWS = 1000;
export const MAX_COLS = 52;

export interface Rect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}
export interface Pos {
  r: number;
  c: number;
}

/** The corners of a selection, in order whichever way it was dragged. */
export const normRect = (a: Pos, b: Pos): Rect => ({ r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) });

/** What a spreadsheet keeps: the cells as typed, how they look, and column widths. */
export interface GridState {
  rows: string[][];
  fmt: Record<string, CellFormat>;
  colW: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

/** Every cell's value. Formulas are worked out once each; a formula that depends on itself shows #CIRC!. */
export function computeGrid(rows: string[][], now?: () => Date): Val[][] {
  const memo = new Map<number, Val>();
  const visiting = new Set<number>();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const key = (r: number, c: number) => r * 100_000 + c;
  const ctx: EvalCtx = {
    now,
    cell(r, c) {
      if (r < 0 || c < 0 || r >= rows.length || c >= (rows[r]?.length ?? 0)) return null;
      const k = key(r, c);
      if (memo.has(k)) return memo.get(k)!;
      if (visiting.has(k)) return err('#CIRC!');
      const raw = rows[r][c];
      let v: Val;
      if (isFormula(raw)) {
        visiting.add(k);
        const ast = parseFormula(raw);
        v = 'k' in ast ? evaluate(ast, ctx) : ast;
        visiting.delete(k);
      } else v = literalValue(raw);
      memo.set(k, v);
      return v;
    },
  };
  return rows.map((row, r) => Array.from({ length: Math.max(width, row.length) }, (_, c) => ctx.cell(r, c)));
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function fixed(n: number, dec: number, thousands: boolean): string {
  const s = Math.abs(n).toFixed(Math.max(0, Math.min(10, dec)));
  const [int, frac] = s.split('.');
  const body = (thousands ? group(int) : int) + (frac ? '.' + frac : '');
  return n < 0 && Number(s) !== 0 ? '-' + body : body;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A value as the cell shows it, in its format. Errors show their code. */
export function formatValue(v: Val, f?: CellFormat): string {
  if (v === null) return '';
  if (isErr(v)) return v.err;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  switch (f?.nf) {
    case 'num':
      return fixed(v, f.dec ?? 2, true);
    case 'int':
      return fixed(Math.round(v), 0, true);
    case 'cur': {
      const s = fixed(Math.abs(v), f.dec ?? 2, true);
      return (v < 0 && Number(s.replace(/,/g, '')) !== 0 ? '-$' : '$') + s;
    }
    case 'pct':
      return fixed(v * 100, f.dec ?? 0, false) + '%';
    case 'date': {
      const d = serialToDate(v);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    default:
      return numberText(v);
  }
}

/** Where the cell's text sits when its format does not say: numbers right, text left, logical values and errors centred. */
export function alignOf(v: Val, f?: CellFormat): 'l' | 'c' | 'r' {
  if (f?.al) return f.al;
  if (typeof v === 'number') return 'r';
  if (typeof v === 'boolean' || isErr(v)) return 'c';
  return 'l';
}

/** How many rows and columns hold anything (the rest is empty space). */
export function usedRange(rows: string[][]): { rows: number; cols: number } {
  let nr = 0;
  let nc = 0;
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell !== '') {
        nr = Math.max(nr, r + 1);
        nc = Math.max(nc, c + 1);
      }
    }),
  );
  return { rows: nr, cols: nc };
}

/** The part of a spreadsheet that has something in it, as the text each cell shows (worked out and formatted): for pictures, exports and search. */
export function displayRows(rows: string[][], fmt: Record<string, CellFormat> = {}, min: { rows?: number; cols?: number } = {}): string[][] {
  const used = usedRange(rows);
  const nr = Math.max(used.rows, min.rows ?? 0);
  const nc = Math.max(used.cols, min.cols ?? 0);
  if (!nr || !nc) return [['']];
  const values = computeGrid(rows);
  return Array.from({ length: Math.min(nr, rows.length) }, (_, r) => Array.from({ length: nc }, (_, c) => formatValue(values[r]?.[c] ?? null, fmt[cellName(r, c)])));
}

/** A grid of at least this many rows and columns, keeping what is there. */
export function ensureSize(rows: string[][], nRows: number, nCols: number): string[][] {
  const width = Math.min(MAX_COLS, Math.max(nCols, rows[0]?.length ?? 0));
  const out = rows.map((r) => (r.length >= width ? r : [...r, ...Array<string>(width - r.length).fill('')]));
  while (out.length < Math.min(MAX_ROWS, nRows)) out.push(Array<string>(width).fill(''));
  return out;
}

/** The numbers in a selection, summed up for the status bar. */
export function rangeStats(values: Val[][], rect: Rect) {
  const nums: number[] = [];
  let count = 0;
  for (let r = rect.r1; r <= rect.r2; r++)
    for (let c = rect.c1; c <= rect.c2; c++) {
      const v = values[r]?.[c] ?? null;
      if (v !== null && v !== '') count++;
      if (typeof v === 'number') nums.push(v);
    }
  const sum = nums.reduce((s, n) => s + n, 0);
  return { count, numbers: nums.length, sum, avg: nums.length ? sum / nums.length : null, min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null };
}

/* ------------------------------------------------------------------ */
/* Editing the grid                                                    */
/* ------------------------------------------------------------------ */

const parseKey = (k: string) => /^([A-Z]+)(\d+)$/.exec(k);
function remapFmt(fmt: Record<string, CellFormat>, f: (r: number, c: number) => Pos | null): Record<string, CellFormat> {
  const out: Record<string, CellFormat> = {};
  for (const [k, v] of Object.entries(fmt)) {
    const m = parseKey(k);
    if (!m) continue;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
    const to = f(Number(m[2]) - 1, c - 1);
    if (to) out[cellName(to.r, to.c)] = v;
  }
  return out;
}

const mapFormulas = (rows: string[][], f: (raw: string) => string) => rows.map((row) => row.map((cell) => (isFormula(cell) ? f(cell) : cell)));

/** Empty rows or columns put in before line `at`; formulas that pointed past it follow. */
export function insertLines(s: GridState, axis: 'row' | 'col', at: number, n = 1): GridState {
  const count = axis === 'row' ? Math.min(n, MAX_ROWS - s.rows.length) : Math.min(n, MAX_COLS - (s.rows[0]?.length ?? 0));
  if (count <= 0) return s;
  let rows = mapFormulas(s.rows, (f) => insertRefs(f, axis, at, count));
  if (axis === 'row') {
    const width = rows[0]?.length ?? 1;
    rows = [...rows.slice(0, at), ...Array.from({ length: count }, () => Array<string>(width).fill('')), ...rows.slice(at)];
  } else rows = rows.map((r) => [...r.slice(0, at), ...Array<string>(count).fill(''), ...r.slice(at)]);
  const fmt = remapFmt(s.fmt, (r, c) => (axis === 'row' ? { r: r >= at ? r + count : r, c } : { r, c: c >= at ? c + count : c }));
  const colW: Record<string, number> = {};
  for (const [k, w] of Object.entries(s.colW)) colW[axis === 'col' && Number(k) >= at ? String(Number(k) + count) : k] = w;
  return { rows, fmt, colW: axis === 'col' ? colW : s.colW };
}

/** Rows or columns removed; formulas that used them show #REF!, the rest follow. Always leaves at least one row and column. */
export function deleteLines(s: GridState, axis: 'row' | 'col', at: number, n = 1): GridState {
  const total = axis === 'row' ? s.rows.length : (s.rows[0]?.length ?? 0);
  const count = Math.min(n, total - at, total - 1);
  if (count <= 0 || at < 0) return s;
  let rows = mapFormulas(s.rows, (f) => deleteRefs(f, axis, at, count));
  rows = axis === 'row' ? [...rows.slice(0, at), ...rows.slice(at + count)] : rows.map((r) => [...r.slice(0, at), ...r.slice(at + count)]);
  const gone = (v: number) => v >= at && v < at + count;
  const fmt = remapFmt(s.fmt, (r, c) => {
    const v = axis === 'row' ? r : c;
    if (gone(v)) return null;
    const nv = v >= at + count ? v - count : v;
    return axis === 'row' ? { r: nv, c } : { r, c: nv };
  });
  const colW: Record<string, number> = {};
  if (axis === 'col') {
    for (const [k, w] of Object.entries(s.colW)) {
      const c = Number(k);
      if (!gone(c)) colW[String(c >= at + count ? c - count : c)] = w;
    }
  }
  return { rows, fmt, colW: axis === 'col' ? colW : s.colW };
}

const sortKey = (v: Val): [number, number | string] => {
  if (v === null || v === '') return [3, 0];
  if (isErr(v)) return [2, v.err];
  if (typeof v === 'number') return [0, v];
  if (typeof v === 'boolean') return [1, Number(v)];
  return [1, v.toLowerCase()];
};

/** The rows of `rect` put in order by the values in column `col`. Empty cells stay last either way. A formula that points along its own row follows its row. */
export function sortRows(s: GridState, rect: Rect, col: number, dir: 'asc' | 'desc'): GridState {
  const values = computeGrid(s.rows);
  const idx = Array.from({ length: rect.r2 - rect.r1 + 1 }, (_, i) => rect.r1 + i);
  const cmp = (a: number, b: number) => {
    const x = sortKey(values[a]?.[col] ?? null);
    const y = sortKey(values[b]?.[col] ?? null);
    if (x[0] === 3 || y[0] === 3) return x[0] === y[0] ? a - b : x[0] === 3 ? 1 : -1; // empties last in both directions
    if (x[0] !== y[0]) return dir === 'asc' ? x[0] - y[0] : y[0] - x[0];
    const c = x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0;
    return c !== 0 ? (dir === 'asc' ? c : -c) : a - b;
  };
  const order = [...idx].sort(cmp);
  const rows = s.rows.map((r) => [...r]);
  const newRowOf = new Map<number, number>();
  order.forEach((from, i) => newRowOf.set(from, rect.r1 + i));
  order.forEach((from, i) => {
    const to = rect.r1 + i;
    for (let c = rect.c1; c <= rect.c2; c++) {
      const raw = s.rows[from][c];
      rows[to][c] = isFormula(raw) ? shiftFormula(raw, to - from, 0) : raw;
    }
  });
  const fmt = remapFmt(s.fmt, (r, c) => (c >= rect.c1 && c <= rect.c2 && newRowOf.has(r) ? { r: newRowOf.get(r)!, c } : { r, c }));
  return { rows, fmt, colW: s.colW };
}

/** The value `k` steps on from a run of numbers (an arithmetic series), or null when the source is not one. */
function seriesStep(src: string[]): number | null {
  const nums = src.map((s) => (isFormula(s) ? NaN : typeof literalValue(s) === 'number' ? (literalValue(s) as number) : NaN));
  if (src.length < 2 || nums.some((n) => Number.isNaN(n))) return null;
  return nums[1] - nums[0];
}

/**
 * Drag the fill handle: the cells of `src` carried on to `to`. Formulas are copied with their relative references moved; two or more
 * numbers carry on as a series (1, 2 → 3, 4…); anything else repeats.
 */
export function fillRange(s: GridState, src: Rect, to: Pos): GridState {
  const down = to.r > src.r2;
  const up = to.r < src.r1;
  const right = to.c > src.c2;
  const left = to.c < src.c1;
  const vertical = down || up;
  if (!vertical && !right && !left) return s;
  const horizontalWins = (right || left) && !vertical;
  const rows = ensureSize(s.rows.map((r) => [...r]), (down ? to.r : src.r2) + 1, (right ? to.c : src.c2) + 1);
  const fmt = { ...s.fmt };
  const lines = horizontalWins ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
  const len = horizontalWins ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1;
  const forward = down || right;
  const steps = horizontalWins ? (right ? to.c - src.c2 : src.c1 - to.c) : down ? to.r - src.r2 : src.r1 - to.r;
  for (let line = 0; line < lines; line++) {
    const at = (i: number): Pos => (horizontalWins ? { r: src.r1 + line, c: src.c1 + i } : { r: src.r1 + i, c: src.c1 + line });
    const srcCells = Array.from({ length: len }, (_, i) => {
      const p = at(i);
      return rows[p.r]?.[p.c] ?? '';
    });
    const step = seriesStep(srcCells);
    for (let k = 1; k <= steps; k++) {
      const from = forward ? (k - 1) % len : len - 1 - ((k - 1) % len);
      const base = at(from);
      const dest: Pos = horizontalWins ? { r: base.r, c: forward ? src.c2 + k : src.c1 - k } : { r: forward ? src.r2 + k : src.r1 - k, c: base.c };
      if (dest.r < 0 || dest.c < 0 || dest.r >= MAX_ROWS || dest.c >= MAX_COLS) continue;
      let raw = srcCells[from];
      if (step !== null) {
        const first = Number(srcCells[0]);
        const idx = forward ? len - 1 + k : -k;
        raw = String(Number((first + (step * idx)).toPrecision(12)));
      } else if (isFormula(raw)) raw = shiftFormula(raw, dest.r - base.r, dest.c - base.c);
      rows[dest.r][dest.c] = raw;
      const f = s.fmt[cellName(base.r, base.c)];
      if (f) fmt[cellName(dest.r, dest.c)] = f;
      else delete fmt[cellName(dest.r, dest.c)];
    }
  }
  return { rows, fmt, colW: s.colW };
}

/** Cells copied from a grid: what they hold, how they look, and where they came from (so formulas can be moved on paste). */
export interface Clip {
  cells: string[][];
  fmts: (CellFormat | undefined)[][];
  origin: Pos;
}

export function copyCells(s: GridState, rect: Rect): Clip {
  const cells: string[][] = [];
  const fmts: (CellFormat | undefined)[][] = [];
  for (let r = rect.r1; r <= rect.r2; r++) {
    cells.push(Array.from({ length: rect.c2 - rect.c1 + 1 }, (_, i) => s.rows[r]?.[rect.c1 + i] ?? ''));
    fmts.push(Array.from({ length: rect.c2 - rect.c1 + 1 }, (_, i) => s.fmt[cellName(r, rect.c1 + i)]));
  }
  return { cells, fmts, origin: { r: rect.r1, c: rect.c1 } };
}

/** Puts a clip down with its top-left cell at `at`. A formula keeps pointing at the same cells relative to itself. */
export function pasteCells(s: GridState, at: Pos, clip: Clip): GridState {
  const h = clip.cells.length;
  const w = Math.max(1, ...clip.cells.map((r) => r.length));
  const rows = ensureSize(s.rows.map((r) => [...r]), at.r + h, at.c + w);
  const fmt = { ...s.fmt };
  for (let i = 0; i < h; i++)
    for (let j = 0; j < w; j++) {
      const r = at.r + i;
      const c = at.c + j;
      if (r >= MAX_ROWS || c >= MAX_COLS) continue;
      const raw = clip.cells[i][j] ?? '';
      rows[r][c] = isFormula(raw) ? shiftFormula(raw, at.r - clip.origin.r, at.c - clip.origin.c) : raw;
      const f = clip.fmts[i]?.[j];
      if (f) fmt[cellName(r, c)] = f;
      else delete fmt[cellName(r, c)];
    }
  return { rows, fmt, colW: s.colW };
}

/** Clears what is typed in a selection (formats stay). */
export function clearCells(s: GridState, rect: Rect): GridState {
  const rows = s.rows.map((r) => [...r]);
  for (let r = rect.r1; r <= Math.min(rect.r2, rows.length - 1); r++) for (let c = rect.c1; c <= Math.min(rect.c2, rows[r].length - 1); c++) rows[r][c] = '';
  return { ...s, rows };
}

/** Changes the format of every cell in a selection; `patch` keys set to undefined are removed. */
export function formatCells(s: GridState, rect: Rect, patch: Partial<Record<keyof CellFormat, CellFormat[keyof CellFormat] | undefined>>): GridState {
  const fmt = { ...s.fmt };
  for (let r = rect.r1; r <= rect.r2; r++)
    for (let c = rect.c1; c <= rect.c2; c++) {
      const k = cellName(r, c);
      const next: Record<string, unknown> = { ...fmt[k] };
      for (const [p, v] of Object.entries(patch)) {
        if (v === undefined) delete next[p];
        else next[p] = v;
      }
      if (Object.keys(next).length) fmt[k] = next as CellFormat;
      else delete fmt[k];
    }
  return { ...s, fmt };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** Reads CSV (comma, semicolon or tab separated; quotes may hold the separator, quotes and line breaks) into rows of text. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/)[0] ?? '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [['']];
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')]);
}

/** Rows of text as CSV, with quotes only where needed. */
export function toCsv(rows: string[][]): string {
  const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}

export const columnLabel = colName;
