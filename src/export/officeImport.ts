/** Opening Word and Excel files (and CSV) as Workspace pages. The zip is read defensively: only the parts needed, with size limits. */
import { strFromU8, unzipSync } from 'fflate';
import type { Block, CalcMeta } from '../types';
import { readDocx } from '../lib/office/docxImport';
import { readSheet } from '../lib/office/xlsxImport';
import { MAX_COLS, MAX_ROWS, ensureSize, parseCsv } from '../lib/office/sheetModel';
import { DOC_WIDTH } from '../lib/office/starters';
import { newId } from '../lib/util';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PART_BYTES = 60 * 1024 * 1024; // what one part may unpack to: a small file that unpacks to gigabytes is refused

export interface Opened {
  app: 'doc' | 'sheet';
  title: string;
  blocks: Block[];
}

const titleOf = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120) || 'Untitled';

/** Only the named parts of the zip, and only if they stay within the size limit. */
export function unzipParts(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, string> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => wanted(f.name) && f.originalSize <= MAX_PART_BYTES });
  } catch {
    throw new Error('That file could not be opened. It may be damaged, or not a Word or Excel file.');
  }
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
}

/** The page a file makes, from its name and bytes. Throws a message fit to show when it is not a file this can open. */
export function openOfficeBytes(name: string, bytes: Uint8Array): Opened {
  if (bytes.length > MAX_FILE_BYTES) throw new Error('That file is too large (the limit is 25 MB).');
  const ext = (name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  const title = titleOf(name);
  if (ext === 'docx') {
    const parts = unzipParts(bytes, (n) => n === 'word/document.xml' || n === 'word/numbering.xml');
    const { html, size } = readDocx(parts);
    return { app: 'doc', title, blocks: [{ id: newId(), type: 'note', style: 'text', x: 0, y: 0, w: DOC_WIDTH[size], h: 600, z: 1, html, doc: { page: true, size } }] };
  }
  if (ext === 'xlsx') {
    const parts = unzipParts(bytes, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/styles.xml' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    const s = readSheet(parts);
    const calc: CalcMeta = { page: true, ...(Object.keys(s.fmt).length ? { fmt: s.fmt } : {}), ...(Object.keys(s.colW).length ? { colW: s.colW } : {}), ...(s.freeze ? { freeze: s.freeze } : {}) };
    return { app: 'sheet', title, blocks: [{ id: newId(), type: 'table', x: 0, y: 0, w: 1400, h: 640, z: 1, rows: ensureSize(s.rows, 60, 14), calc } as Block] };
  }
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const rows = parseCsv(new TextDecoder().decode(bytes)).slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS));
    return { app: 'sheet', title, blocks: [{ id: newId(), type: 'table', x: 0, y: 0, w: 1400, h: 640, z: 1, rows: ensureSize(rows, 60, 14), calc: { page: true } } as Block] };
  }
  throw new Error('Only Word (.docx), Excel (.xlsx) and CSV files can be opened.');
}

export async function openOfficeFile(file: File): Promise<Opened> {
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is too large (the limit is 25 MB).');
  return openOfficeBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}
