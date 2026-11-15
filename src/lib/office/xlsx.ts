/**
 * A spreadsheet as an Excel workbook (.xlsx), built by hand (pure: returns the files of the zip). Values, formulas (with their
 * worked-out result cached, so a viewer that does not recalculate still shows numbers), bold, italic, alignment, number formats,
 * fill colours, column widths and a frozen top row carry over.
 */
import type { CellFormat, NoteColor } from '../../types';
import { cellName, isErr, isFormula, literalValue, type Val } from './formula';
import { computeGrid, usedRange, type GridState } from './sheetModel';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const FILL_HEX: Record<NoteColor, string> = { yellow: 'F6E7A1', orange: 'F4CFA4', red: 'F0B9B0', pink: 'F1C3D6', purple: 'D6C6EE', blue: 'BCD3F0', green: 'C3E2BF', gray: 'D5D9DE' };
const FILL_ORDER = Object.keys(FILL_HEX) as NoteColor[];

export const xmlText = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const numFmtCode = (f: CellFormat): string | null => {
  const dec = Math.max(0, Math.min(10, f.dec ?? 2));
  const zeros = dec ? '.' + '0'.repeat(dec) : '';
  switch (f.nf) {
    case 'num': return '#,##0' + zeros;
    case 'int': return '#,##0';
    case 'cur': return '"$"#,##0' + zeros;
    case 'pct': return '0' + zeros + '%';
    case 'date': return 'yyyy-mm-dd';
    default: return null;
  }
};

/** The styles part and a way to find the style index (`s=`) of a cell format. */
function styles(fmts: Iterable<CellFormat>) {
  const numFmts: string[] = [];
  const xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const index = new Map<string, number>();
  const styleOf = (f: CellFormat | undefined): number => {
    if (!f) return 0;
    const key = JSON.stringify([f.b, f.i, f.al, f.nf, f.nf ? f.dec : undefined, f.bg]);
    const have = index.get(key);
    if (have !== undefined) return have;
    const code = numFmtCode(f);
    let numFmtId = 0;
    if (code) {
      const at = numFmts.indexOf(code);
      numFmtId = 164 + (at >= 0 ? at : numFmts.push(code) - 1);
    }
    const fontId = (f.b ? 1 : 0) + (f.i ? 2 : 0);
    const fillId = f.bg ? 2 + FILL_ORDER.indexOf(f.bg) : 0;
    const align = f.al ? `<alignment horizontal="${f.al === 'l' ? 'left' : f.al === 'r' ? 'right' : 'center'}"/>` : '';
    xfs.push(`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"${f.al ? ' applyAlignment="1"' : ''}>${align}</xf>`);
    index.set(key, xfs.length - 1);
    return xfs.length - 1;
  };
  for (const f of fmts) styleOf(f);
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}">` +
    (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xmlText(c)}"/>`).join('')}</numFmts>` : '') +
    '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><name val="Calibri"/></font><font><b/><i/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    `<fills count="${2 + FILL_ORDER.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${FILL_ORDER.map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${FILL_HEX[c]}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills>` +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return { xml, styleOf };
}

function cellXml(ref: string, s: number, raw: string, v: Val): string {
  const st = s ? ` s="${s}"` : '';
  if (isFormula(raw)) {
    const f = `<f>${xmlText(raw.slice(1))}</f>`;
    if (isErr(v)) return `<c r="${ref}"${st} t="e">${f}<v>${xmlText(v.err)}</v></c>`;
    if (typeof v === 'number') return `<c r="${ref}"${st}>${f}<v>${Number.isFinite(v) ? v : 0}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}"${st} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
    return `<c r="${ref}"${st} t="str">${f}<v>${xmlText(v === null ? '' : String(v))}</v></c>`;
  }
  if (typeof v === 'number') return `<c r="${ref}"${st}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${st} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (raw === '') return `<c r="${ref}"${st}/>`;
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlText(raw)}</t></is></c>`;
}

/** The files of the .xlsx zip, by path. */
export function buildXlsx(grid: GridState, opts: { freeze?: number; sheetName?: string } = {}): Record<string, string> {
  const values = computeGrid(grid.rows);
  const used = usedRange(grid.rows);
  const { xml: stylesXml, styleOf } = styles(Object.values(grid.fmt));
  const rows: string[] = [];
  for (let r = 0; r < Math.max(used.rows, 0); r++) {
    const cells: string[] = [];
    for (let c = 0; c < Math.max(used.cols, 0); c++) {
      const raw = grid.rows[r]?.[c] ?? '';
      const f = grid.fmt[cellName(r, c)];
      if (raw === '' && !f) continue;
      cells.push(cellXml(cellName(r, c), styleOf(f), raw, raw === '' ? null : values[r]?.[c] ?? literalValue(raw)));
    }
    if (cells.length) rows.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  }
  const widths = Object.entries(grid.colW).filter(([c, w]) => Number.isInteger(Number(c)) && Number(w) > 0);
  const cols = widths.length ? `<cols>${widths.map(([c, w]) => `<col min="${Number(c) + 1}" max="${Number(c) + 1}" width="${Math.max(2, Math.round((Number(w) / 7) * 100) / 100)}" customWidth="1"/>`).join('')}</cols>` : '';
  const n = opts.freeze && opts.freeze > 0 ? Math.min(opts.freeze, 1000) : 0;
  const pane = n ? `<pane ySplit="${n}" topLeftCell="A${n + 1}" activePane="bottomLeft" state="frozen"/>` : '';
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows.join('')}</sheetData></worksheet>`;
  const name = xmlText((opts.sheetName ?? 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet1');
  return {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': stylesXml,
    'xl/worksheets/sheet1.xml': sheet,
  };
}
