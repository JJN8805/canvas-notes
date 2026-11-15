/**
 * A Word file (.docx, read from its parts) as the HTML of a text box: headings, paragraphs with their alignment, bold, italic,
 * underline, strike-through, line breaks, bulleted and numbered lists, and tables as rows of text. Everything written is escaped text
 * between tags this function chooses, so nothing in the file can add markup of its own. Pure.
 */
import { child, kids, parseXml, textOf, type XNode } from './ooxml';
import { escapeHtml } from '../util';

const MAX_PARAS = 50_000;

interface Numbering { ordered: Map<string, boolean> }

function readNumbering(xml: string | undefined): Numbering {
  const ordered = new Map<string, boolean>();
  if (!xml) return { ordered };
  const root = parseXml(xml);
  const abstract = new Map<string, boolean>();
  for (const a of kids(root, 'abstractNum')) {
    const lvl0 = kids(a, 'lvl').find((l) => l.attrs.ilvl === '0') ?? kids(a, 'lvl')[0];
    abstract.set(a.attrs.abstractNumId, (child(lvl0, 'numFmt')?.attrs.val ?? 'bullet') !== 'bullet');
  }
  for (const n of kids(root, 'num')) ordered.set(n.attrs.numId, abstract.get(child(n, 'abstractNumId')?.attrs.val ?? '') ?? false);
  return { ordered };
}

const on = (rPr: XNode | undefined, tag: string) => {
  const n = child(rPr, tag);
  return !!n && n.attrs.val !== '0' && n.attrs.val !== 'false' && n.attrs.val !== 'none';
};

function runsHtml(p: XNode): string {
  let out = '';
  const walk = (n: XNode) => {
    for (const c of n.children) {
      if (c.name === 'r') {
        const rPr = child(c, 'rPr');
        let text = '';
        for (const part of c.children) {
          if (part.name === 't') text += escapeHtml(textOf(part));
          else if (part.name === 'tab') text += '    ';
          else if (part.name === 'br' || part.name === 'cr') text += '<br>';
        }
        if (!text) continue;
        if (on(rPr, 'b')) text = `<strong>${text}</strong>`;
        if (on(rPr, 'i')) text = `<em>${text}</em>`;
        if (on(rPr, 'u')) text = `<u>${text}</u>`;
        if (on(rPr, 'strike')) text = `<s>${text}</s>`;
        out += text;
      } else if (c.name === 'hyperlink' || c.name === 'smartTag' || c.name === 'sdt' || c.name === 'sdtContent' || c.name === 'ins') walk(c);
    }
  };
  walk(p);
  return out;
}

const alignStyle = (pPr: XNode | undefined) => {
  const jc = child(pPr, 'jc')?.attrs.val;
  const a = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' ? 'justify' : '';
  return a ? ` style="text-align: ${a}"` : '';
};

const headingLevel = (style: string): 1 | 2 | 3 | 0 => {
  const m = /^(?:heading|Heading)\s*(\d)$/.exec(style);
  if (style.toLowerCase() === 'title') return 1;
  if (!m) return 0;
  return Math.min(3, Math.max(1, Number(m[1]))) as 1 | 2 | 3;
};

export interface ImportedDoc {
  html: string;
  size: 'letter' | 'a4';
}

/** The document's text box HTML and paper size. `files` holds the text of the file's parts by path. */
export function readDocx(files: Record<string, string | undefined>): ImportedDoc {
  const docXml = files['word/document.xml'];
  if (!docXml) throw new Error('That file has no document in it.');
  const body = child(parseXml(docXml), 'body');
  if (!body) throw new Error('That file has no document in it.');
  const numbering = readNumbering(files['word/numbering.xml']);
  const html: string[] = [];
  let open: 'ul' | 'ol' | null = null;
  let count = 0;
  const closeList = () => {
    if (open) html.push(`</${open}>`);
    open = null;
  };
  const para = (p: XNode) => {
    if (++count > MAX_PARAS) throw new Error('That document is too long to open here.');
    const pPr = child(p, 'pPr');
    const style = child(pPr, 'pStyle')?.attrs.val ?? '';
    const numId = child(child(pPr, 'numPr'), 'numId')?.attrs.val;
    const text = runsHtml(p);
    if (numId && numId !== '0') {
      const kind = numbering.ordered.get(numId) ? 'ol' : 'ul';
      if (open !== kind) {
        closeList();
        html.push(`<${kind}>`);
        open = kind;
      }
      html.push(`<li><p>${text}</p></li>`);
      return;
    }
    closeList();
    const h = headingLevel(style);
    if (h) html.push(`<h${h}${alignStyle(pPr)}>${text}</h${h}>`);
    else html.push(`<p${alignStyle(pPr)}>${text}</p>`);
  };
  const block = (n: XNode) => {
    if (n.name === 'p') para(n);
    else if (n.name === 'tbl') {
      closeList();
      for (const tr of kids(n, 'tr')) {
        const cells = kids(tr, 'tc').map((tc) => kids(tc, 'p').map((p) => textOf(p)).join(' ').trim());
        html.push(`<p>${escapeHtml(cells.join(' | '))}</p>`);
      }
    } else if (n.name === 'sdt') for (const c of child(n, 'sdtContent')?.children ?? []) block(c);
  };
  for (const n of body.children) block(n);
  closeList();
  const pg = child(body, 'sectPr') ? child(child(body, 'sectPr'), 'pgSz') : undefined;
  const w = Number(pg?.attrs.w);
  return { html: html.join('') || '<p></p>', size: w > 11000 && w < 12000 ? 'a4' : 'letter' };
}
