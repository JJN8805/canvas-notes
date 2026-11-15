import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { buildDocx } from '../src/lib/office/docx';
import { buildXlsx } from '../src/lib/office/xlsx';
import { parseXml } from '../src/lib/office/ooxml';
import { nearestColor, readSheet } from '../src/lib/office/xlsxImport';
import { readDocx } from '../src/lib/office/docxImport';
import { openOfficeBytes } from '../src/export/officeImport';
import { pageToDocx, pageToXlsx } from '../src/export/officeExport';
import { createOfficePageData } from './officeData';
import { computeGrid } from '../src/lib/office/sheetModel';
import type { Block } from '../src/types';

const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

describe('reading XML', () => {
  it('reads elements, attributes, entities, CDATA and ignores comments, PIs and doctypes', () => {
    const n = parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><a:r x="1" b=\'&amp;\'><!-- c --><b>t&lt;&#65;&#x42;</b><c/><![CDATA[<raw>]]></a:r>');
    expect(n.name).toBe('r');
    expect(n.attrs).toEqual({ x: '1', b: '&' });
    expect(n.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(n.children[0].text).toBe('t<AB');
    expect(n.text).toBe('<raw>');
  });
  it('does not expand entities it does not know, and refuses absurd nesting', () => {
    expect(parseXml('<a>&e;</a>').text).toBe('&e;');
    expect(() => parseXml('<a>'.repeat(300))).toThrow(/too/);
  });
});

describe('opening a spreadsheet', () => {
  const grid = {
    rows: [['Item', 'Cost', 'Note'], ['Pens', '2.5', 'a < b & "c"'], ['Total', '=SUM(B2:B2)', '=B2*2'], ['', 'TRUE', '']],
    fmt: { A1: { b: 1 as const, bg: 'blue' as const }, B2: { nf: 'cur' as const, dec: 2, al: 'r' as const }, B3: { nf: 'pct' as const, dec: 1, i: 1 as const }, C2: { nf: 'date' as const } },
    colW: { '0': 140 },
  };
  it('what we write, we read back: cells, formulas, formats, widths, freeze', () => {
    const files = buildXlsx(grid, { freeze: 1 });
    const s = readSheet(files);
    expect(s.rows[0].slice(0, 3)).toEqual(['Item', 'Cost', 'Note']);
    expect(s.rows[1].slice(0, 3)).toEqual(['Pens', '2.5', 'a < b & "c"']);
    expect(s.rows[2].slice(1, 3)).toEqual(['=SUM(B2:B2)', '=B2*2']);
    expect(s.rows[3][1]).toBe('TRUE');
    expect(s.fmt.A1).toMatchObject({ b: 1, bg: 'blue' });
    expect(s.fmt.B2).toMatchObject({ nf: 'cur', al: 'r' });
    expect(s.fmt.B3).toMatchObject({ nf: 'pct', dec: 1, i: 1 });
    expect(s.fmt.C2).toMatchObject({ nf: 'date' });
    expect(s.colW).toEqual({ '0': 140 });
    expect(s.freeze).toBe(1);
  });
  it('a real starter goes out and comes back with the same values', () => {
    const page = createOfficePageData('sheet', 'sheet-budget');
    const opened = openOfficeBytes('Budget.xlsx', pageToXlsx(page)!);
    const orig = (page.blocks[0] as { rows: string[][] }).rows;
    const back = (opened.blocks[0] as { rows: string[][] }).rows;
    expect(opened).toMatchObject({ app: 'sheet', title: 'Budget' });
    expect(computeGrid(back).slice(0, 9).map((r) => r.slice(0, 5))).toEqual(computeGrid(orig).slice(0, 9).map((r) => r.slice(0, 5)));
  });
  it('reads shared strings, inline strings and numbers from a file written by another program', () => {
    const wb = '<workbook xmlns:r="x"><sheets><sheet name="S" sheetId="1" r:id="rId9"/></sheets></workbook>';
    const rels = '<Relationships><Relationship Id="rId9" Target="worksheets/data.xml"/></Relationships>';
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1"><v>42</v></c><c r="C1" t="inlineStr"><is><t>hi</t></is></c></row><row r="3"><c r="B3" t="b"><v>1</v></c><c r="A3"><f>A1&amp;"!"</f><v>x</v></c></row></sheetData></worksheet>';
    const sst = '<sst><si><t>zero</t></si><si><r><t>one </t></r><r><t>two</t></r></si></sst>';
    const s = readSheet({ 'xl/workbook.xml': wb, 'xl/_rels/workbook.xml.rels': rels, 'xl/worksheets/data.xml': sheet, 'xl/sharedStrings.xml': sst });
    expect(s.rows[0].slice(0, 3)).toEqual(['one two', '42', 'hi']);
    expect(s.rows[2].slice(0, 2)).toEqual(['=A1&"!"', 'TRUE']);
  });
  it('maps fills to the nearest app colour and ignores white', () => {
    expect(nearestColor('FFBCD3F0')).toBe('blue');
    expect(nearestColor('FFC8E6C9')).toBe('green');
    expect(nearestColor('FFFFFFFF')).toBeNull();
    expect(nearestColor('nonsense')).toBeNull();
  });
  it('keeps cells inside the sheet limits and drops control characters', () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a\u0001b</t></is></c><c r="ZZ5000" t="inlineStr"><is><t>far</t></is></c></row></sheetData></worksheet>';
    const s = readSheet({ 'xl/worksheets/sheet1.xml': sheet });
    expect(s.rows[0][0]).toBe('ab');
    expect(s.rows.length).toBeLessThanOrEqual(1000);
    expect(s.rows.flat()).not.toContain('far');
  });
  it('opens CSV too, and refuses what it does not know', () => {
    const o = openOfficeBytes('data.csv', strToU8('a,b\n1,2\n'));
    expect((o.blocks[0] as { rows: string[][] }).rows.slice(0, 2).map((r) => r.slice(0, 2))).toEqual([['a', 'b'], ['1', '2']]);
    expect(() => openOfficeBytes('x.pdf', strToU8('x'))).toThrow(/Only Word/);
    expect(() => openOfficeBytes('x.xlsx', strToU8('not a zip'))).toThrow(/could not be opened/);
    expect(() => openOfficeBytes('x.xlsx', zip({ 'other.txt': 'x' }))).toThrow(/no spreadsheet/);
  });
});

describe('opening a document', () => {
  it('what we write, we read back: headings, emphasis, lists, quotes, alignment, paper', () => {
    const html = '<h1>Title</h1><p>One <strong>bold</strong> <em>it</em> <u>u</u><br>next</p><ul><li><p>a</p></li><li><p>b</p></li></ul><ol><li><p>x</p></li></ol><p style="text-align: right">r &amp; l</p>';
    const parts = buildDocx(html, 'a4');
    const out = readDocx(parts);
    expect(out.size).toBe('a4');
    expect(out.html).toContain('<h1>Title</h1>');
    expect(out.html).toContain('<strong>bold</strong>');
    expect(out.html).toContain('<em>it</em>');
    expect(out.html).toContain('<u>u</u>');
    expect(out.html).toContain('<br>next');
    expect(out.html).toContain('<p style="text-align: right">r &amp; l</p>');
    expect(out.html).toContain('a</p>'); // list items come back as paragraphs
  });
  it('a real starter goes out and comes back with its words and headings', () => {
    const opened = openOfficeBytes('Report.docx', pageToDocx(createOfficePageData('doc', 'doc-report'))!);
    const b = opened.blocks[0] as Block & { html: string; doc: { page: true } };
    expect(opened).toMatchObject({ app: 'doc', title: 'Report' });
    expect(b.html).toContain('<h1>Report title</h1>');
    expect(b.html).toContain('Recommendations');
    expect(b.doc.page).toBe(true);
  });
  it('reads real Word markup: styles, numbering, tables, hyperlinks', () => {
    const doc =
      '<w:document xmlns:w="w"><w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Sub</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr><w:hyperlink><w:r><w:rPr><w:b/></w:rPr><w:t>two</w:t></w:r></w:hyperlink></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>';
    const num = '<w:numbering xmlns:w="w"><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="7"/></w:num></w:numbering>';
    const out = readDocx({ 'word/document.xml': doc, 'word/numbering.xml': num });
    expect(out.html).toBe('<h2>Sub</h2><ol><li><p>one</p></li><li><p><strong>two</strong></p></li></ol><p>A | B</p>');
    expect(out.size).toBe('letter');
  });
  it('markup inside the text is shown as text, never as markup', () => {
    const doc = '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;</w:t></w:r></w:p></w:body></w:document>';
    const html = readDocx({ 'word/document.xml': doc }).html;
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(html).not.toMatch(/<script|<img/);
  });
  it('refuses a file with no document, and one that unpacks to something huge', () => {
    expect(() => readDocx({})).toThrow(/no document/);
    const bomb = zip({ 'word/document.xml': 'a'.repeat(61 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(200_000);
    expect(() => openOfficeBytes('bomb.docx', bomb)).toThrow(/no document/); // the oversized part is skipped, so nothing is read
  });
  it('refuses a file over the size limit', () => {
    expect(() => openOfficeBytes('big.docx', new Uint8Array(26 * 1024 * 1024))).toThrow(/too large/);
  });
});
