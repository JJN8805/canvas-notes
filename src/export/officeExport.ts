/** Workspace pages as Word and Excel files: the pure builders in `lib/office/` zipped. */
import { strToU8, zipSync } from 'fflate';
import type { Page } from '../types';
import { docBlock, sheetBlock } from '../lib/office/app';
import { buildDocx } from '../lib/office/docx';
import { buildXlsx } from '../lib/office/xlsx';

const zip = (files: Record<string, string>): Uint8Array<ArrayBuffer> => {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text); // [Content_Types].xml first, as Office writes it
  return new Uint8Array(zipSync(entries, { level: 6 })) as Uint8Array<ArrayBuffer>;
};

/** The page as an Excel workbook, or null when it is not a spreadsheet page. */
export function pageToXlsx(page: Page): Uint8Array<ArrayBuffer> | null {
  const t = sheetBlock(page.blocks);
  if (!t) return null;
  return zip(buildXlsx({ rows: t.rows, fmt: t.calc?.fmt ?? {}, colW: t.calc?.colW ?? {} }, { freeze: t.calc?.freeze, sheetName: page.title || 'Sheet1' }));
}

/** The page as a Word document, or null when it is not a document page. */
export function pageToDocx(page: Page): Uint8Array<ArrayBuffer> | null {
  const d = docBlock(page.blocks);
  if (!d) return null;
  return zip(buildDocx(d.html, d.doc?.size ?? 'letter', page.title));
}
