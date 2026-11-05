/**
 * Repairs for pages read from storage. A page can reach this device damaged: written by another version of the app, changed
 * in a sync, or edited by hand. The screens assume every box has the fields its type promises, and when one doesn't they throw,
 * which blanks the whole window. So whatever is read is brought into shape first: missing or wrong-typed fields get harmless
 * defaults, and entries that can't be a box at all (a null, a number) are left out. Valid data passes through unchanged.
 */
import type { Block, Page } from '../types';
import { newId } from './util';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const text = (v: unknown) => (typeof v === 'string' ? v : '');

function cleanItems(v: unknown) {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((i) => ({ ...i, id: typeof i.id === 'string' && i.id ? i.id : newId(), text: text(i.text), done: i.done === true }));
}

function cleanRows(v: unknown): string[][] {
  const rows = Array.isArray(v) ? v.filter(Array.isArray).map((r) => (r as unknown[]).map((c) => (typeof c === 'string' ? c : c == null ? '' : String(c)))) : [];
  if (!rows.length) return [['']];
  const width = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')]);
}

/** One box brought into shape, or null when it can't be a box. Boxes of a type this version doesn't know are kept as they are. */
export function cleanBlock(b: unknown): Block | null {
  if (!isObj(b) || typeof b.type !== 'string' || !b.type) return null;
  const out: Record<string, unknown> = {
    ...b,
    id: typeof b.id === 'string' && b.id ? b.id : newId(),
    x: num(b.x, 0),
    y: num(b.y, 0),
    w: Math.max(1, num(b.w, 240)),
    h: Math.max(1, num(b.h, 60)),
    z: num(b.z, 1),
  };
  switch (b.type) {
    case 'text':
    case 'sticky':
      out.html = text(b.html);
      break;
    case 'checklist':
      out.items = cleanItems(b.items);
      // a tracking record that isn't whole would break the attendance code: the list simply isn't tracked any more
      if (b.track !== undefined) {
        const t = b.track;
        if (!(isObj(t) && typeof t.start === 'string' && typeof t.day === 'string' && isObj(t.log) && isObj(t.first))) delete out.track;
      }
      break;
    case 'code':
      out.code = text(b.code);
      break;
    case 'table':
      out.rows = cleanRows(b.rows);
      break;
    case 'frame':
      out.title = text(b.title);
      break;
    case 'audio':
    case 'pdf':
      out.name = text(b.name);
      out.fileId = text(b.fileId);
      break;
    case 'image':
      out.imageId = text(b.imageId);
      out.aspect = num(b.aspect, 1) > 0 ? num(b.aspect, 1) : 1;
      break;
    case 'card':
      out.cardId = text(b.cardId);
      break;
  }
  return out as unknown as Block;
}

export function cleanBlocks(v: unknown): Block[] {
  if (!Array.isArray(v)) return [];
  const out: Block[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const b = cleanBlock(raw);
    if (!b) continue;
    if (seen.has(b.id)) b.id = newId(); // two boxes with one id would move and edit together
    seen.add(b.id);
    out.push(b);
  }
  return out;
}

export function cleanArrows(v: unknown): Page['arrows'] {
  return Array.isArray(v) ? (v.filter((a) => isObj(a) && typeof a.from === 'string' && typeof a.to === 'string') as Page['arrows']) : [];
}

export const cleanTags = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []);
