/**
 * A document as a Word file (.docx), built by hand (pure: returns the files of the zip). The text box's HTML becomes paragraphs:
 * headings 1 to 3, bold, italic, underline, strike-through, code, quotes, bulleted and numbered lists, line breaks and alignment.
 */
import { xmlText } from './xlsx';

interface Run {
  text: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  code?: boolean;
  br?: boolean;
}
export interface Para {
  style: 'Normal' | 'Heading1' | 'Heading2' | 'Heading3' | 'Quote';
  align?: 'left' | 'center' | 'right' | 'both';
  runs: Run[];
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e: string) => ENT[e] ?? (/^#\d+$/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : m));
const alignOf = (attrs: string): Para['align'] => {
  const m = /text-align:\s*(left|center|right|justify)/i.exec(attrs);
  return m ? (m[1].toLowerCase() === 'justify' ? 'both' : (m[1].toLowerCase() as Para['align'])) : undefined;
};

/** The paragraphs of some text-box HTML. */
export function htmlToParas(html: string): Para[] {
  const out: Para[] = [];
  let cur: Para | null = null;
  const flags = { b: 0, i: 0, u: 0, s: 0, code: 0 };
  const lists: { ordered: boolean; n: number }[] = [];
  let quote = 0;
  let pending = ''; // a bullet or number waiting for the first text of an item
  const open = (style: Para['style'], align?: Para['align']) => {
    cur = { style: quote && style === 'Normal' ? 'Quote' : style, align, runs: [] };
    out.push(cur);
  };
  const close = () => {
    cur = null;
  };
  const add = (text: string) => {
    if (!text) return;
    if (!cur) open('Normal');
    if (pending) {
      cur!.runs.push({ text: pending });
      pending = '';
    }
    cur!.runs.push({ text, b: !!flags.b, i: !!flags.i, u: !!flags.u, s: !!flags.s, code: !!flags.code });
  };
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      add(decode(m[4].replace(/\s*\n\s*/g, ' ')));
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? '';
    if (/^h[1-3]$/.test(tag)) {
      if (closing) close();
      else (close(), open(`Heading${tag[1]}` as Para['style'], alignOf(attrs)));
    } else if (tag === 'p') {
      if (closing) {
        if (cur) close();
        else if (!pending) out.push({ style: quote ? 'Quote' : 'Normal', runs: [] }); // an empty paragraph stays as a blank line
      } else if (!(lists.length && cur)) {
        // inside a list item the item's own paragraph is used; elsewhere each <p> starts a paragraph
        close();
        open('Normal', alignOf(attrs));
      }
    } else if (tag === 'ul' || tag === 'ol') {
      if (closing) lists.pop();
      else lists.push({ ordered: tag === 'ol', n: 0 });
      close();
    } else if (tag === 'li') {
      if (closing) close();
      else {
        close();
        const l = lists[lists.length - 1];
        const depth = Math.max(0, lists.length - 1);
        pending = '   '.repeat(depth) + (l?.ordered ? `${++l.n}. ` : '• ');
        open('Normal');
      }
    } else if (tag === 'blockquote') {
      close();
      quote += closing ? -1 : 1;
      quote = Math.max(0, quote);
    } else if (tag === 'br') {
      if (!cur) open('Normal');
      cur!.runs.push({ text: '', br: true });
    } else if (tag === 'strong' || tag === 'b') flags.b += closing ? -1 : 1;
    else if (tag === 'em' || tag === 'i') flags.i += closing ? -1 : 1;
    else if (tag === 'u') flags.u += closing ? -1 : 1;
    else if (tag === 's' || tag === 'strike' || tag === 'del') flags.s += closing ? -1 : 1;
    else if (tag === 'code') flags.code += closing ? -1 : 1;
    for (const k of Object.keys(flags) as (keyof typeof flags)[]) flags[k] = Math.max(0, flags[k]);
  }
  return out.length ? out : [{ style: 'Normal', runs: [] }];
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const runXml = (r: Run) => {
  if (r.br) return '<w:r><w:br/></w:r>';
  const props = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (r.s ? '<w:strike/>' : '') + (r.u ? '<w:u w:val="single"/>' : '') + (r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : '');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlText(r.text)}</w:t></w:r>`;
};
const paraXml = (p: Para) => {
  const ppr = (p.style !== 'Normal' ? `<w:pStyle w:val="${p.style}"/>` : '') + (p.align ? `<w:jc w:val="${p.align}"/>` : '');
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${p.runs.map(runXml).join('')}</w:p>`;
};

const PAGE = { letter: { w: 12240, h: 15840 }, a4: { w: 11906, h: 16838 } } as const;

/** The files of the .docx zip, by path. */
export function buildDocx(html: string, size: 'letter' | 'a4' = 'letter', title = ''): Record<string, string> {
  const pg = PAGE[size];
  const body = htmlToParas(html).map(paraXml).join('');
  const style = (id: string, name: string, extra: string, basedOn = 'Normal') =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/><w:next w:val="Normal"/><w:qFormat/>${extra}</w:style>`;
  return {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlText(title)}</dc:title></cp:coreProperties>`,
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
      style('Heading1', 'heading 1', '<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr>') +
      style('Heading2', 'heading 2', '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr>') +
      style('Heading3', 'heading 3', '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr>') +
      style('Quote', 'Quote', '<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr>') +
      '</w:styles>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="${pg.w}" w:h="${pg.h}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  };
}
