import type { AddKind } from '../types';

/** One entry of the "/" insert menu (Notion's slash menu): what it adds, how it is named, and other words people might type for it. */
export interface SlashItem {
  type: AddKind;
  label: string;
  hint: string;
  words: string[];
}

export const SLASH_ITEMS: SlashItem[] = [
  { type: 'text', label: 'Text', hint: 'Plain writing, any size', words: ['paragraph', 'note', 'write', 'heading', 'title'] },
  { type: 'sticky', label: 'Sticky note', hint: 'A coloured note', words: ['post-it', 'postit', 'idea', 'memo'] },
  { type: 'checklist', label: 'To-do list', hint: 'Boxes you can tick', words: ['checklist', 'todo', 'to-do', 'tasks', 'check'] },
  { type: 'code', label: 'Code', hint: 'Monospaced, keeps spacing', words: ['snippet', 'programming', 'json', 'script'] },
  { type: 'table', label: 'Table', hint: 'Rows and columns', words: ['grid', 'spreadsheet', 'rows', 'columns'] },
  { type: 'frame', label: 'Frame', hint: 'A labelled area that holds boxes', words: ['group', 'section', 'container', 'board', 'slide'] },
];

/**
 * The entries that match what was typed after "/", best first: the name starts with it, then a word of it does, then it appears anywhere
 * (in the name, the hint or the other words). Nothing typed = all of them, in their usual order.
 */
export function filterSlash(query: string, items: SlashItem[] = SLASH_ITEMS): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const scored: { item: SlashItem; score: number; at: number }[] = [];
  items.forEach((item, at) => {
    const label = item.label.toLowerCase();
    const parts = [label, ...item.words].flatMap((w) => w.split(/[\s-]+/));
    const score = label.startsWith(q) ? 0 : item.words.some((w) => w.startsWith(q)) || parts.some((p) => p.startsWith(q)) ? 1 : [label, item.hint.toLowerCase(), ...item.words].some((s) => s.includes(q)) ? 2 : -1;
    if (score >= 0) scored.push({ item, score, at });
  });
  return scored.sort((a, b) => a.score - b.score || a.at - b.at).map((s) => s.item);
}
