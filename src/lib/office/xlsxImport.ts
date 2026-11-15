/**
 * An Excel workbook (.xlsx, read from its parts) as a spreadsheet: the first sheet's cells, formulas, bold, italic, alignment, number
 * formats, fill colours (nearest of the app's colours), column widths and frozen top rows. Pure.
 */
import type { CellFormat, NoteColor } from '../../types';
import { cellName, parseCellName } from './formula';
import { child, kids, parseXml, textOf, type XNode } from './ooxml';
import { MAX_COLS, MAX_ROWS, ensureSize, type GridState } from './sheetModel';

const MAX_CELL = 32_000;
const PALETTE: Record<NoteColor, [number, number, number]> = {
  yellow: [0xf6, 0xe7, 0xa1], orange: [0xf4, 0xcf, 0xa4], red: [0xf0, 0xb9, 0xb0], pink: [0xf1, 0xc3, 0xd6],
  purple: [0xd6, 0xc6, 0xee], blue: [0xbc, 0xd3, 0xf0], green: [0xc3, 0xe2, 0xbf], gray: [0xd5, 0xd9, 0xde],
};
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, MAX_CELL);

/** The app colour nearest to an ARGB or RGB hex fill, or none for white, near white and no fill. */
export function nearestColor(hex: string): NoteColor | null {
  const h = hex.length === 8 ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const rgb: [number, number, number] = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  if (rgb.every((v) => v > 245)) return null;
  let best: NoteColor | null = null;
  let bestD = Infinity;
  for (const [name, p] of Object.entries(PALETTE) as [NoteColor, [number, number, number]][]) {
    const d = (p[0] - rgb[0]) ** 2 + (p[1] - rgb[1]) ** 2 + (p[2] - rgb[2]) ** 2;
    if (d < bestD) (bestD = d), (best = name);
  }
  return best;
}

interface Xf { fmt: CellFormat }

function readStyles(xml: string | undefined): Xf[] {
  if (!xml) return [];
  const root = parseXml(xml);
  const fonts = kids(child(root, 'fonts'), 'font').map((f) => ({ b: !!child(f, 'b'), i: !!child(f, 'i') }));
  const fills = kids(child(root, 'fills'), 'fill').map((f) => {
    const p = child(child(f, 'patternFill'), 'fgColor');
    return p?.attrs.rgb ? nearestColor(p.attrs.rgb) : null;
  });
  const custom = new Map<number, string>(kids(child(root, 'numFmts'), 'numFmt').map((n) => [Number(n.attrs.numFmtId), n.attrs.formatCode ?? '']));
  return kids(child(root, 'cellXfs'), 'xf').map((xf) => {
    const fmt: CellFormat = {};
    const font = fonts[Number(xf.attrs.fontId ?? 0)];
    if (font?.b) fmt.b = 1;
    if (font?.i) fmt.i = 1;
    const fill = fills[Number(xf.attrs.fillId ?? 0)];
    if (fill) fmt.bg = fill;
    const al = child(xf, 'alignment')?.attrs.horizontal;
    if (al === 'left') fmt.al = 'l';
    else if (al === 'center') fmt.al = 'c';
    else if (al === 'right') fmt.al = 'r';
    const id = Number(xf.attrs.numFmtId ?? 0);
    const rawCode = custom.get(id) ?? '';
    const money = /[$€£¥]/.test(rawCode);
    const code = rawCode.toLowerCase().replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    if (BUILTIN_DATE.has(id) || /[ymd]/.test(code) && !/0|#/.test(code)) fmt.nf = 'date';
    else if (id === 9 || id === 10 || code.includes('%')) {
      fmt.nf = 'pct';
      fmt.dec = (code.split('.')[1] ?? '').replace(/[^0#]/g, '').length;
    } else if (money || [5, 6, 7, 8, 41, 42, 43, 44].includes(id)) {
      fmt.nf = 'cur';
      fmt.dec = (code.split('.')[1] ?? '').replace(/[^0#]/g, '').length;
    } else if (id === 1 || id === 3 || (code && /^[#,0]+$/.test(code) && !code.includes('.'))) fmt.nf = 'int';
    else if (id === 2 || id === 4 || (code && /[#0]\.[0#]+/.test(code))) {
      fmt.nf = 'num';
      fmt.dec = (code.split('.')[1] ?? '').replace(/[^0#]/g, '').length || 2;
    }
    return { fmt };
  });
}

const sharedStrings = (xml: string | undefined): string[] => (xml ? kids(parseXml(xml), 'si').map((si) => textOf(si)) : []);

/** Where the first sheet's XML lives, from the workbook and its relationships. */
export function firstSheetPath(workbookXml: string, relsXml: string): string | null {
  const first = kids(child(parseXml(workbookXml), 'sheets'), 'sheet')[0];
  const id = first?.attrs.id;
  const target = kids(parseXml(relsXml), 'Relationship').find((r) => r.attrs.Id === id)?.attrs.Target;
  if (!target) return null;
  return target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
}

export interface ImportedSheet extends GridState {
  freeze: number;
}

/** The sheet's cells and looks. `files` holds the text of the workbook's parts by path. */
export function readSheet(files: Record<string, string | undefined>): ImportedSheet {
  const wb = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];
  const path = wb && rels ? firstSheetPath(wb, rels) : null;
  const sheetXml = (path && files[path]) || files['xl/worksheets/sheet1.xml'];
  if (!sheetXml) throw new Error('That file has no spreadsheet in it.');
  const styles = readStyles(files['xl/styles.xml']);
  const strings = sharedStrings(files['xl/sharedStrings.xml']);
  const sheet = parseXml(sheetXml);
  const fmt: Record<string, CellFormat> = {};
  let rows: string[][] = [['']];
  for (const row of kids(child(sheet, 'sheetData'), 'row')) {
    for (const c of kids(row, 'c')) {
      const at = parseCellName(c.attrs.r ?? '');
      if (!at || at.r >= MAX_ROWS || at.c >= MAX_COLS) continue;
      const f = child(c, 'f');
      const v = child(c, 'v');
      const t = c.attrs.t;
      let raw = '';
      if (f && textOf(f).trim()) raw = '=' + textOf(f).trim();
      else if (t === 's') raw = strings[Number(v ? textOf(v) : NaN)] ?? '';
      else if (t === 'inlineStr') raw = textOf(child(c, 'is') ?? { name: '', attrs: {}, children: [], text: '' });
      else if (t === 'b') raw = v && textOf(v).trim() === '1' ? 'TRUE' : 'FALSE';
      else raw = v ? textOf(v) : '';
      raw = clean(raw);
      const xf = styles[Number(c.attrs.s ?? 0)];
      if (raw === '' && !xf?.fmt.bg) continue;
      rows = ensureSize(rows, at.r + 1, at.c + 1);
      rows[at.r][at.c] = raw;
      if (xf && Object.keys(xf.fmt).length) fmt[cellName(at.r, at.c)] = { ...xf.fmt };
    }
  }
  const colW: Record<string, number> = {};
  for (const col of kids(child(sheet, 'cols'), 'col')) {
    const w = Number(col.attrs.width);
    const lo = Number(col.attrs.min);
    const hi = Math.min(Number(col.attrs.max), lo + 60);
    if (!(w > 0) || !Number.isInteger(lo)) continue;
    for (let c = lo - 1; c < hi && c < MAX_COLS; c++) colW[String(c)] = Math.min(600, Math.max(32, Math.round(w * 7)));
  }
  const pane = child(child(child(sheet, 'sheetViews'), 'sheetView'), 'pane');
  const freeze = pane?.attrs.state === 'frozen' ? Math.max(0, Math.min(50, Math.floor(Number(pane.attrs.ySplit) || 0))) : 0;
  return { rows: rows.length ? rows : [['']], fmt, colW, freeze };
}

export type { XNode };
