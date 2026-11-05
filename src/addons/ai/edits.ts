/**
 * Letting the assistant change the page, with the user in charge. Pure code (no app state), so it is tested without the app.
 *
 * How it works: the page is shown to the model box by box, each with a short label (b1, b2 …) instead of its real id. The model may
 * end its answer with one fenced `edits` block: a JSON list of changes that refer to boxes by label. Nothing is changed by the answer
 * itself. The app turns the list into a *proposal* (what each box is now, and what it would become), the user reads it and presses
 * Apply, and only then is the page changed, as a single undo step. A box that was edited after the page was sent is left alone.
 */
import type { Block, Page } from '../../types';
import { htmlToText } from '../../graph/text';
import { readingOrder } from '../../export/export';
import { markdownToHtml } from './markdown';

export const EDIT_FENCE = 'edits';
export const MAX_OPS = 20;
const MAX_TEXT = 20000;
const MAX_ITEMS = 100;
const MAX_ROWS = 60;
const MAX_COLS = 12;

export type EditOp =
  | { kind: 'text'; box: string; markdown: string }
  | { kind: 'checklist'; box: string; items: { text: string; done: boolean }[] }
  | { kind: 'code'; box: string; code: string }
  | { kind: 'table'; box: string; rows: string[][] }
  | { kind: 'add'; what: 'text' | 'sticky'; markdown: string }
  | { kind: 'add'; what: 'checklist'; items: { text: string; done: boolean }[] }
  | { kind: 'delete'; box: string };

/** What the model was shown: label → real box id, and a fingerprint of the box then, to notice later changes. */
export type AliasMap = Record<string, { id: string; fp: string }>;

export interface EditableContext {
  text: string;
  chars: number;
  blocks: number;
  truncated: boolean;
  aliases: AliasMap;
  usedSelection: boolean;
}

/** The kinds of box the assistant can change. Pictures, audio, PDFs, cards and frames can't be changed; attendance tables are generated. */
export const isEditable = (b: Block): boolean =>
  b.type === 'text' || b.type === 'sticky' || b.type === 'checklist' || b.type === 'code' || (b.type === 'table' && !b.attendance);

/** Everything about a box that an edit could change, as one string. */
export function fingerprint(b: Block): string {
  switch (b.type) {
    case 'text':
    case 'sticky':
      return b.html ?? '';
    case 'checklist':
      return JSON.stringify(b.items.map((i) => [i.text, i.done]));
    case 'code':
      return b.code ?? '';
    case 'table':
      return JSON.stringify(b.rows);
    default:
      return b.id;
  }
}

/** The box's content as plain text (what the model reads, and what the user sees as "before"). */
export function plainText(b: Block): string {
  switch (b.type) {
    case 'text':
    case 'sticky':
      return htmlToText(b.html ?? '');
    case 'checklist':
      return b.items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n');
    case 'code':
      return b.code ?? '';
    case 'table':
      return b.rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
    case 'frame':
      return b.title ?? '';
    case 'image':
      return b.ocr ? `Text in it: ${b.ocr}` : b.alt && !b.heat ? b.alt : '';
    case 'audio':
    case 'pdf':
      return b.name;
    default:
      return '';
  }
}

const KIND_LABEL: Partial<Record<Block['type'], string>> = { text: 'text box', sticky: 'sticky note', checklist: 'checklist', code: 'code box', table: 'table' };
export const kindLabel = (b: Block) => KIND_LABEL[b.type] ?? b.type;

/** The page for the model, one labelled section per box, in reading order. With selected boxes, only those (they keep their labels). */
export function buildEditableContext(page: Pick<Page, 'title' | 'tags' | 'blocks'>, selectedIds: readonly string[] = [], maxChars = 24000): EditableContext {
  const ordered = readingOrder(page.blocks);
  const labelOf = new Map<string, string>();
  let n = 0;
  for (const b of ordered) if (isEditable(b)) labelOf.set(b.id, `b${++n}`);
  const chosen = selectedIds.length ? ordered.filter((b) => selectedIds.includes(b.id)) : [];
  const usedSelection = chosen.length > 0;
  const shown = usedSelection ? chosen : ordered;
  const aliases: AliasMap = {};
  const parts: string[] = [];
  let truncated = false;
  let size = 0;
  for (const b of shown) {
    const label = labelOf.get(b.id);
    const body = plainText(b);
    if (!label && !body.trim()) continue;
    const head = label ? `[${label}: ${kindLabel(b)}]` : `[${kindLabel(b)}, read only]`;
    const part = `${head}\n${body}`;
    if (size + part.length > maxChars) {
      truncated = true;
      break; // boxes after this are not shown, so they get no label and can't be changed
    }
    size += part.length;
    parts.push(part);
    if (label) aliases[label] = { id: b.id, fp: fingerprint(b) };
  }
  const title = page.title ? `Title: ${page.title}\n\n` : '';
  const tail = truncated ? '\n\n[The rest of the page was left out because it is long.]' : '';
  const text = title + parts.join('\n\n') + tail;
  return { text, chars: text.length, blocks: parts.length, truncated, aliases, usedSelection };
}

/** Added to the instructions when the assistant may suggest changes. */
export const EDIT_PROMPT =
  'The user\'s page is shown box by box. Each box you can change has a label such as [b1: text box]. ' +
  'When the user asks you to change, fix, rewrite, add to or remove something on the page, do it by ending your answer with ONE block like this, and say in a sentence or two what you changed:\n' +
  '```' + EDIT_FENCE + '\n' +
  '[{"op":"text","box":"b1","markdown":"the new full text of that box"},\n' +
  ' {"op":"checklist","box":"b2","items":[{"text":"Buy milk","done":false}]},\n' +
  ' {"op":"code","box":"b3","code":"the new full code"},\n' +
  ' {"op":"table","box":"b4","rows":[["A","B"],["1","2"]]},\n' +
  ' {"op":"add","what":"text","markdown":"a new text box"},\n' +
  ' {"op":"add","what":"checklist","items":[{"text":"First","done":false}]},\n' +
  ' {"op":"delete","box":"b5"}]\n' +
  '```\n' +
  'Rules: an edit replaces the WHOLE content of its box, so include everything that should stay. Change only what was asked, and only boxes that have a label. ' +
  'Use "markdown" for text boxes and sticky notes. The changes are NOT made when you answer: the user is shown them and decides, so never say that you have already changed the page. ' +
  'If the user only asks a question, answer it and include no edits block.';

/* ------------------------------------------------------------------ */
/* Reading the model's answer                                          */
/* ------------------------------------------------------------------ */

const fenceRe = new RegExp('```' + EDIT_FENCE + '[^\\S\\n]*\\n([\\s\\S]*?)(?:```|$)', 'i');

/** The answer as shown to the user: the edits block is cut out (also while it is still being written). */
export function visibleText(answer: string): string {
  const at = answer.search(new RegExp('```' + EDIT_FENCE, 'i'));
  return (at < 0 ? answer : answer.slice(0, at)).trim();
}

const str = (v: unknown, max = MAX_TEXT): string | null => (typeof v === 'string' && v.length <= max ? v : null);

function items(v: unknown): { text: string; done: boolean }[] | null {
  if (!Array.isArray(v) || v.length > MAX_ITEMS) return null;
  const out: { text: string; done: boolean }[] = [];
  for (const i of v) {
    if (typeof i === 'string') out.push({ text: i.slice(0, 500), done: false });
    else if (i && typeof i === 'object' && typeof (i as { text?: unknown }).text === 'string') {
      out.push({ text: (i as { text: string }).text.slice(0, 500), done: (i as { done?: unknown }).done === true });
    } else return null;
  }
  return out;
}

/** One change from the model's list, or null when it is malformed (a bad entry is dropped, the rest still stand). */
export function cleanOp(raw: unknown): EditOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const box = typeof o.box === 'string' ? o.box.trim().toLowerCase() : '';
  switch (o.op) {
    case 'text': {
      const markdown = str(o.markdown ?? o.text);
      return box && markdown !== null ? { kind: 'text', box, markdown } : null;
    }
    case 'checklist': {
      const list = items(o.items);
      return box && list ? { kind: 'checklist', box, items: list } : null;
    }
    case 'code': {
      const code = str(o.code);
      return box && code !== null ? { kind: 'code', box, code } : null;
    }
    case 'table': {
      const rows = o.rows;
      if (!box || !Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) return null;
      const clean: string[][] = [];
      for (const r of rows) {
        if (!Array.isArray(r) || !r.length || r.length > MAX_COLS) return null;
        clean.push(r.map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c).slice(0, 500) : '')));
      }
      const width = Math.max(...clean.map((r) => r.length));
      return { kind: 'table', box, rows: clean.map((r) => [...r, ...Array(width - r.length).fill('')]) };
    }
    case 'add': {
      if (o.what === 'checklist') {
        const list = items(o.items);
        return list ? { kind: 'add', what: 'checklist', items: list } : null;
      }
      if (o.what === 'text' || o.what === 'sticky') {
        const markdown = str(o.markdown ?? o.text);
        return markdown ? { kind: 'add', what: o.what, markdown } : null;
      }
      return null;
    }
    case 'delete':
      return box ? { kind: 'delete', box } : null;
    default:
      return null;
  }
}

export interface ParsedAnswer {
  /** What to show as the answer. */
  message: string;
  ops: EditOp[];
  /** Entries that were not understood, so the user can be told rather than silently getting less than the model said. */
  dropped: number;
}

/** Splits an answer into its words and its proposed changes. An answer without an edits block has none. */
export function parseAnswer(answer: string): ParsedAnswer {
  const message = visibleText(answer);
  const m = answer.match(fenceRe);
  if (!m) return { message, ops: [], dropped: 0 };
  let list: unknown;
  try {
    list = JSON.parse(m[1].trim());
  } catch {
    return { message, ops: [], dropped: 1 };
  }
  if (!Array.isArray(list)) list = [list];
  const raw = list as unknown[];
  const ops: EditOp[] = [];
  let dropped = 0;
  for (const r of raw.slice(0, MAX_OPS)) {
    const op = cleanOp(r);
    if (op) ops.push(op);
    else dropped++;
  }
  dropped += Math.max(0, raw.length - MAX_OPS);
  return { message, ops, dropped };
}

/* ------------------------------------------------------------------ */
/* From a list of changes to a proposal the user can read              */
/* ------------------------------------------------------------------ */

export interface ProposedChange {
  op: EditOp;
  /** The real id of the box this changes (absent for an added box). */
  id?: string;
  title: string;
  before: string;
  after: string;
  /** Why this one can't be applied, if so. */
  problem?: string;
}

const clip = (s: string, n = 600) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);

function afterText(op: EditOp): string {
  switch (op.kind) {
    case 'text':
      return htmlToText(markdownToHtml(op.markdown));
    case 'add':
      return op.what === 'checklist' ? op.items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n') : htmlToText(markdownToHtml(op.markdown));
    case 'checklist':
      return op.items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n');
    case 'code':
      return op.code;
    case 'table':
      return op.rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
    case 'delete':
      return '';
  }
}

/** The changes against the page as it is now. Each is checked: the box must exist, be the right kind, and be unchanged since it was sent. */
export function propose(ops: readonly EditOp[], aliases: AliasMap, blocks: readonly Block[]): ProposedChange[] {
  const out: ProposedChange[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    if (op.kind === 'add') {
      out.push({ op, title: op.what === 'checklist' ? 'Add a checklist' : op.what === 'sticky' ? 'Add a sticky note' : 'Add a text box', before: '', after: clip(afterText(op)) });
      continue;
    }
    const known = aliases[op.box];
    const b = known && blocks.find((x) => x.id === known.id);
    const base = { op, id: known?.id, after: clip(afterText(op)) };
    if (!known) {
      out.push({ ...base, title: `Box ${op.box}`, before: '', problem: 'The assistant named a box that was not on the page it was shown.' });
      continue;
    }
    if (!b) {
      out.push({ ...base, title: `Box ${op.box}`, before: '', problem: 'That box is no longer on the page.' });
      continue;
    }
    const title = `${op.kind === 'delete' ? 'Delete' : 'Change'} the ${kindLabel(b)}`;
    const mismatch =
      (op.kind === 'text' && b.type !== 'text' && b.type !== 'sticky') ||
      (op.kind === 'checklist' && b.type !== 'checklist') ||
      (op.kind === 'code' && b.type !== 'code') ||
      (op.kind === 'table' && (b.type !== 'table' || !!b.attendance));
    let problem: string | undefined;
    if (mismatch) problem = `This is a ${kindLabel(b)}, so that kind of change doesn't fit it.`;
    else if (fingerprint(b) !== known.fp) problem = 'This box was changed after the page was sent, so it is left alone. Ask again to work from its current content.';
    else if (seen.has(b.id)) problem = 'Another change to the same box is already in this list.';
    if (!problem) seen.add(b.id);
    out.push({ ...base, title, before: clip(plainText(b)), problem });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

/** What to put into a box for an accepted change. Returns the fields to merge into the box. */
export function fieldsFor(op: EditOp, existing?: Block): Record<string, unknown> | null {
  switch (op.kind) {
    case 'text':
      return { html: markdownToHtml(op.markdown) };
    case 'code':
      return { code: op.code };
    case 'table':
      return { rows: op.rows };
    case 'checklist': {
      // keep a box's item ids where the text is unchanged, so a tracked list keeps its history
      const old = existing?.type === 'checklist' ? existing.items : [];
      const used = new Set<string>();
      return {
        items: op.items.map((i, n) => {
          const same = old.find((o) => !used.has(o.id) && o.text === i.text) ?? (old[n] && !used.has(old[n].id) && !i.text.trim() ? old[n] : undefined);
          if (same) used.add(same.id);
          return { id: same?.id ?? `ai${Date.now().toString(36)}${n}`, text: i.text, done: i.done };
        }),
      };
    }
    default:
      return null;
  }
}

/** A short line for the "applied" note. */
export function summarize(changes: readonly ProposedChange[]): string {
  const n = changes.length;
  return `${n} change${n === 1 ? '' : 's'}`;
}
