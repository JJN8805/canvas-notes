/**
 * Script files (pure): Fountain (the stored text itself), formatted plain text, and a PDF written by hand with real selectable text in
 * Courier (the standard font every reader has, 12 pt, 10 characters to the inch), laid out by the same `layoutPages` as the screen.
 */
import { layoutPages, wrap, type PrintLine } from './layout';
import { metaValue, serializeScript } from './fountain';
import { FORMATS, type ScriptDoc, type ScriptFormat } from './model';

const CH = 7.2; // points per character at 12 pt Courier
const LINE = 12;
const PAGE_W = 612;
const PAGE_H = 792;
const TOP = 72;

const titleOf = (doc: ScriptDoc) => metaValue(doc, 'Title') || 'Untitled';
const hasTitlePage = (doc: ScriptDoc) => doc.meta.some(([, v]) => v.trim());

/** The lines of the title page, as printed: title centred a third of the way down, credit and author under it, contact at the bottom. */
function titleLines(doc: ScriptDoc, width: number): { col: number; row: number; text: string; bold?: boolean }[] {
  const out: { col: number; row: number; text: string; bold?: boolean }[] = [];
  const center = (t: string, row: number, bold = false) => out.push({ col: Math.max(0, Math.floor((width - t.length) / 2)), row, text: t, bold });
  let row = 18;
  for (const t of wrap(titleOf(doc).toUpperCase(), width)) center(t, row++, true);
  row += 2;
  const credit = metaValue(doc, 'Credit');
  if (credit) center(credit, row++);
  row++;
  const author = metaValue(doc, 'Author') || metaValue(doc, 'Authors');
  for (const t of wrap(author, width)) if (t) center(t, row++);
  const source = metaValue(doc, 'Source');
  if (source) {
    row++;
    for (const t of wrap(source, width)) center(t, row++);
  }
  let r = 44;
  for (const t of metaValue(doc, 'Contact').split('\n').reverse()) out.push({ col: 0, row: r--, text: t });
  const date = metaValue(doc, 'Draft date');
  if (date) out.push({ col: Math.max(0, width - date.length), row: 44, text: date });
  return out.map((o) => ({ ...o }));
}

/** Formatted plain text: the page as it prints, with page numbers, for a text file or the clipboard. */
export function scriptToText(doc: ScriptDoc, format: ScriptFormat): string {
  const f = FORMATS[format];
  const pages = layoutPages(doc.els, format);
  const width = f.left + 70;
  const draw = (l: PrintLine) => {
    const left = ' '.repeat(f.left + l.col) + l.text;
    return l.right ? left.padEnd(f.left + l.right.col) + l.right.text : left;
  };
  const out: string[] = [];
  if (hasTitlePage(doc)) {
    const rows: string[] = Array.from({ length: 46 }, () => '');
    for (const t of titleLines(doc, 60)) rows[t.row] = rows[t.row].padEnd(f.left + t.col) + t.text;
    out.push(rows.map((r) => r.replace(/\s+$/, '')).join('\n'));
  }
  pages.forEach((p, i) => {
    const head = i === 0 ? '' : `${' '.repeat(Math.max(0, width - 12))}${f.id === 'manuscript' ? `${titleOf(doc).slice(0, 20)} ${p.number}` : `${p.number}.`}`.replace(/\s+$/, '') + '\n\n';
    out.push(head + p.lines.map((l) => draw(l).replace(/\s+$/, '')).join('\n'));
  });
  return out.join('\n\f\n') + '\n';
}

export const scriptToFountain = (doc: ScriptDoc): string => serializeScript(doc);

/* ---------------- PDF ---------------- */

const WIN: Record<string, number> = { '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, '…': 0x85, '•': 0x95, '€': 0x80, '™': 0x99 };
/** One character as a WinAnsi byte; anything the standard fonts cannot draw becomes "?" (so a PDF in another script is better made from the text file). */
const byteOf = (c: string): number => {
  const code = c.codePointAt(0) ?? 63;
  if (WIN[c] !== undefined) return WIN[c];
  if ((code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff)) return code;
  return 63;
};
const esc = (t: string): string => {
  let s = '';
  for (const c of t) {
    const b = byteOf(c);
    const ch = String.fromCharCode(b);
    s += ch === '(' || ch === ')' || ch === '\\' ? '\\' + ch : ch;
  }
  return s;
};

const FONT = (bold?: boolean, italic?: boolean) => (bold && italic ? 'F4' : bold ? 'F2' : italic ? 'F3' : 'F1');

export function scriptToPdf(doc: ScriptDoc, format: ScriptFormat): Uint8Array<ArrayBuffer> {
  const f = FORMATS[format];
  const pages = layoutPages(doc.els, format);
  const streams: string[] = [];
  const text = (x: number, y: number, t: string, font: string) => (t ? `BT /${font} 12 Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(t)}) Tj ET\n` : '');
  const baseline = (row: number) => PAGE_H - TOP - 9 - row * LINE;
  if (hasTitlePage(doc)) {
    let s = '';
    for (const t of titleLines(doc, 60)) s += text((f.left + t.col) * CH, baseline(t.row), t.text, FONT(t.bold));
    streams.push(s);
  }
  pages.forEach((p, i) => {
    let s = '';
    if (i > 0) {
      const label = f.id === 'manuscript' ? `${titleOf(doc).slice(0, 24)} / ${p.number}` : `${p.number}.`;
      s += text((f.left + 70) * CH - label.length * CH, PAGE_H - 36, label, 'F1');
    }
    p.lines.forEach((l, row) => {
      s += text((f.left + l.col) * CH, baseline(row), l.text, FONT(l.bold, l.italic));
      if (l.right) s += text((f.left + l.right.col) * CH, baseline(row), l.right.text, FONT(l.right.bold, l.right.italic));
    });
    streams.push(s);
  });
  if (!streams.length) streams.push('');

  // objects: 1 catalog, 2 pages, 3-6 fonts, then (page, content) pairs
  const objs: string[] = [];
  const kids = streams.map((_, i) => `${7 + i * 2} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${streams.length} >>`;
  ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'].forEach((n, k) => {
    objs[3 + k] = `<< /Type /Font /Subtype /Type1 /BaseFont /${n} /Encoding /WinAnsiEncoding >>`;
  });
  streams.forEach((s, i) => {
    objs[7 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${8 + i * 2} 0 R >>`;
    objs[8 + i * 2] = `<< /Length ${s.length} >>\nstream\n${s}endstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info << /Title (${esc(titleOf(doc))}) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
