import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildDocx, htmlToParas } from '../src/lib/office/docx';
import { buildXlsx } from '../src/lib/office/xlsx';
import { pageToDocx, pageToXlsx } from '../src/export/officeExport';
import { createOfficePageData } from './officeData';

/** Every XML part is well formed: tags open and close in order. (A real parser is not available here; the browser check opens the files in LibreOffice.) */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?[\s\S]*?\?>/g, '').matchAll(/<(\/?)([\w:.-]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]);
  }
  return stack.length === 0;
}
const parts = (files: Record<string, string>) => Object.entries(files);

describe('Word files', () => {
  it('turns text-box HTML into paragraphs with headings, emphasis, lists and quotes', () => {
    const p = htmlToParas('<h1>Title</h1><p>One <strong>bold</strong> and <em>it</em><br>next</p><ul><li><p>a</p></li><li><p>b</p></li></ul><ol><li><p>x</p></li></ol><blockquote><p>quoted</p></blockquote><p style="text-align: right">r &amp; l</p>');
    expect(p.map((x) => x.style)).toEqual(['Heading1', 'Normal', 'Normal', 'Normal', 'Normal', 'Quote', 'Normal']);
    expect(p[1].runs.filter((r) => r.b).map((r) => r.text)).toEqual(['bold']);
    expect(p[1].runs.some((r) => r.br)).toBe(true);
    expect(p[2].runs.map((r) => r.text).join('')).toBe('• a');
    expect(p[4].runs.map((r) => r.text).join('')).toBe('1. x');
    expect(p[6]).toMatchObject({ align: 'right' });
    expect(p[6].runs.map((r) => r.text).join('')).toBe('r & l');
  });
  it('keeps blank paragraphs as blank lines and never returns nothing', () => {
    expect(htmlToParas('<p></p>')).toEqual([{ style: 'Normal', runs: [] }]);
    expect(htmlToParas('')).toEqual([{ style: 'Normal', runs: [] }]);
    expect(htmlToParas('<p>a</p><p></p><p>b</p>').map((p) => p.runs.length)).toEqual([1, 0, 1]);
  });
  it('writes well-formed parts, escapes text, and sets the paper size', () => {
    const f = buildDocx('<p>5 &lt; 6 &amp; "q"</p>', 'a4', 'My <doc>');
    for (const [name, xml] of parts(f)) expect(balanced(xml), name).toBe(true);
    expect(f['word/document.xml']).toContain('5 &lt; 6 &amp; &quot;q&quot;');
    expect(f['word/document.xml']).toContain('w:w="11906"');
    expect(f['docProps/core.xml']).toContain('My &lt;doc&gt;');
    expect(buildDocx('<p>x</p>', 'letter')['word/document.xml']).toContain('w:w="12240"');
  });
  it('makes a zip a Word-compatible reader can open: content types first, every part listed', () => {
    const z = unzipSync(pageToDocx(createOfficePageData('doc', 'doc-report'))!);
    expect(Object.keys(z)[0]).toBe('[Content_Types].xml');
    expect(strFromU8(z['word/document.xml'])).toContain('Summary');
    expect(pageToDocx(createOfficePageData('sheet', 'sheet-blank'))).toBeNull();
  });
});

describe('Excel files', () => {
  const grid = {
    rows: [['Item', 'Cost', 'Note'], ['Pens', '2.5', 'a < b & "c"'], ['Total', '=SUM(B2:B2)', '=B2*2'], ['', '', '=1/0']],
    fmt: { A1: { b: 1 as const, bg: 'blue' as const }, B2: { nf: 'cur' as const, al: 'r' as const }, B3: { nf: 'pct' as const, dec: 1, i: 1 as const } },
    colW: { '0': 140 },
  };
  it('writes values, cached formula results and errors', () => {
    const x = buildXlsx(grid, { freeze: 1 })['xl/worksheets/sheet1.xml'];
    expect(x).toContain('<c r="B2" s=');
    expect(x).toContain('<v>2.5</v>');
    expect(x).toContain('<f>SUM(B2:B2)</f><v>2.5</v>');
    expect(x).toContain('<f>B2*2</f><v>5</v>');
    expect(x).toContain('t="e"><f>1/0</f><v>#DIV/0!</v>');
    expect(x).toContain('a &lt; b &amp; &quot;c&quot;');
    expect(x).toContain('state="frozen"');
    expect(x).toContain('<col min="1" max="1" width="20" customWidth="1"/>');
  });
  it('writes styles for bold, fills, number formats and alignment, once each', () => {
    const f = buildXlsx(grid);
    const s = f['xl/styles.xml'];
    expect(s).toContain('formatCode="&quot;$&quot;#,##0.00"');
    expect(s).toContain('formatCode="0.0%"');
    expect(s).toContain('<alignment horizontal="right"/>');
    expect(s).toContain('rgb="FFBCD3F0"');
    expect((s.match(/<xf /g) ?? []).length).toBe(1 + 1 + 3); // the cell style, the default, then one per distinct format
  });
  it('is well formed, names the sheet safely and survives an empty sheet', () => {
    for (const files of [buildXlsx(grid), buildXlsx({ rows: [['']], fmt: {}, colW: {} }, { sheetName: 'a/b?*[x]:y' })]) for (const [n, xml] of parts(files)) expect(balanced(xml), n).toBe(true);
    expect(buildXlsx({ rows: [['']], fmt: {}, colW: {} }, { sheetName: 'a/b?*[x]:y' })['xl/workbook.xml']).toContain('name="a b   x  y"');
    expect(buildXlsx({ rows: [['']], fmt: {}, colW: {} })['xl/worksheets/sheet1.xml']).toContain('<sheetData></sheetData>');
  });
  it('makes a zip with the parts Excel needs, from a real starter', () => {
    const z = unzipSync(pageToXlsx(createOfficePageData('sheet', 'sheet-budget'))!);
    expect(Object.keys(z)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']));
    expect(strFromU8(z['xl/worksheets/sheet1.xml'])).toContain('<f>');
    expect(pageToXlsx(createOfficePageData('doc', 'doc-blank'))).toBeNull();
  });
});
