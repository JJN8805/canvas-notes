/**
 * A picture for a menu entry, chosen by what its words mean (first match wins), so every menu shows icons next to its words and a person can
 * pick by the picture. An entry can name its own icon (`icon`); this is the fallback. Pure.
 */
import type { IconName } from '../components/ui/Icon';

const RULES: [RegExp, IconName][] = [
  [/^(delete|trash|empty|clear (completed|done))/i, 'trash'],
  [/^remove|^forget|^disconnect|^cancel/i, 'close'],
  [/^(rename|edit name)/i, 'rename'],
  [/^(edit|change|set)\b.*\b(icon|emoji)/i, 'sparkle'],
  [/\b(icon|emoji)\b/i, 'sparkle'],
  [/^edit\b/i, 'edit'],
  [/^(duplicate|copy)\b/i, 'copy'],
  [/^paste/i, 'insert'],
  [/^cut\b/i, 'trash'],
  [/^archive|^open the archive/i, 'archive'],
  [/^(restore|undo)\b/i, 'undo'],
  [/^redo\b/i, 'redo'],
  [/\b(pdf)\b/i, 'pdf'],
  [/\b(png|image|picture|cover|photo)\b/i, 'image'],
  [/\b(excel|spreadsheet|csv|xlsx|table)\b/i, 'table'],
  [/\b(markdown|word|docx|document|\.md)\b/i, 'text'],
  [/^(export|download|save as file|save a copy)|\bexport\b/i, 'export'],
  [/^move (up|down)/i, 'swap'],
  [/^(move to|move into|top level|copy to)|\bmove\b/i, 'move'],
  [/^(new|add|create)\b.*\b(workspace)\b/i, 'workspace'],
  [/^(new|add|create)\b.*\b(group|folder|section)\b|^(ungrouped|no group)\b|\b(group|folder)\b/i, 'folder'],
  [/^quick note|^new (page|note|card|template|slide|document|spreadsheet|presentation)/i, 'plus'],
  [/^(add|insert|new)\b/i, 'plus'],
  [/colou?r|swatch|background/i, 'palette'],
  [/template/i, 'template'],
  [/\bpin\b/i, 'pin'],
  [/\bunlock/i, 'unlock'],
  [/\block/i, 'lock'],
  [/\blinks?\b|\blinked\b/i, 'link'],
  [/\b(layer|front|forward|backward|behind|above the drawing|order)\b|^send to back/i, 'layer'],
  [/^select\b/i, 'select'],
  [/^(find|search)\b|\bsearch\b/i, 'search'],
  [/^(today|journal)\b|\btoday\b/i, 'today'],
  [/\b(week|weekly|calendar|attendance)\b/i, 'calendar'],
  [/\bworkspace/i, 'workspace'],
  [/\b(tidy|align|distribute|arrange)\b/i, 'outline'],
  [/\b(page size|portrait|landscape|infinite|add room)\b/i, 'pages'],
  [/\bsticky\b/i, 'sticky'],
  [/\b(code)\b/i, 'code'],
  [/\b(frame)\b/i, 'frame'],
  [/\b(text|heading)\b/i, 'text'],
  [/\b(list|checklist|to-do)\b/i, 'checklist'],
  [/\b(audio|recording|record)\b/i, 'audio'],
  [/\b(draw|drawing|ink)\b/i, 'draw'],
  [/\b(history|versions)\b/i, 'history'],
  [/\b(sync)\b/i, 'sync'],
  [/\b(star|favorite|favourite)\b/i, 'star'],
  [/\b(focus)\b/i, 'focus'],
  [/^(open|go to|switch to|show)\b/i, 'pages'],
  [/\b(settings)\b/i, 'settings'],
  [/\bgraph|3d\b/i, 'graph'],
  [/\b(card)\b/i, 'card'],
  [/\btag/i, 'tag'],
];

/** The icon that best says what a menu entry does, or null when none fits. */
export function iconForLabel(label: string): IconName | null {
  const text = label.replace(/\s+/g, ' ').trim();
  for (const [re, icon] of RULES) if (re.test(text)) return icon;
  return null;
}
