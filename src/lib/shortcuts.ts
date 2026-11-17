import { MOD_LABEL } from './util';
import { DEFAULT_KEYMAP, type Keymap } from './keymap';

export interface ShortcutGroup {
  title: string;
  rows: [keys: string, what: string][];
}

const M = MOD_LABEL;
const ALT = MOD_LABEL === 'Ctrl' ? 'Alt' : '⌥';

/** Every keyboard shortcut on a page, grouped, with the one-letter keys as set in Settings. The one list behind the `?` sheet and Settings → About. */
export function shortcutGroups(k: Keymap = DEFAULT_KEYMAP): ShortcutGroup[] {
  return [
  {
    title: 'Add',
    rows: [
      [k.sticky, 'Sticky note (at the pointer)'],
      [k.text, 'Text box'],
      [k.checklist, 'List (checklist)'],
      [k.code, 'Code box'],
      [k.table, 'Table'],
      [k.frame, 'Frame'],
      ['/', 'Insert menu at the pointer: type to filter, Enter adds'],
      ['Double-click', 'Text box where you click'],
      ['Tab', 'New sticky joined by an arrow to the selected box'],
    ],
  },
  {
    title: 'Select and edit',
    rows: [
      [`${M} + A`, 'Select all boxes'],
      ['Shift + click', 'Add a box to the selection'],
      ['Drag on empty space', 'Select boxes with a rectangle'],
      ['Enter', 'Start typing in the selected box'],
      ['Esc', 'Leave the box / clear the selection'],
      [`${M} + D`, 'Duplicate'],
      [`${M} + drag`, 'Drag a copy and leave the original'],
      ['Delete', 'Delete (Undo appears right away)'],
      [`${M} + Shift + L`, 'Lock or unlock the selected boxes'],
      [`${ALT} + N`, 'Switch the selected notes to the next style (text, sticky, code)'],
      ['Right-click', 'Menu for the box or the page'],
      [`${M} + Z / ${M} + Shift + Z`, 'Undo / redo'],
      ['Arrow keys (Shift = 1 px)', 'Nudge by 8 px'],
    ],
  },
  {
    title: 'Arrange',
    rows: [
      [`${ALT} + A / H / D`, 'Align left / centre / right'],
      [`${ALT} + W / V / S`, 'Align top / middle / bottom'],
      [`${ALT} + Shift + H / V`, 'Spread evenly across / down'],
      [`${M} + ]  /  ${M} + [`, 'Forward / backward one place'],
      [`${M} + Shift + ]  /  [`, 'To the front / to the back'],
      [`${ALT} while dragging`, 'Move without snapping'],
    ],
  },
  {
    title: 'View',
    rows: [
      ['Space + drag, or middle mouse', 'Pan the page'],
      [`${M} + scroll`, 'Zoom'],
      [`${M} + = / − / 0`, 'Zoom in / out / 100%'],
      [`${M} + 1`, 'Fit everything on the page'],
      ['Shift + 2', 'Zoom to the selected boxes'],
      [k.minimap, 'Show or hide the map in the corner'],
      [k.hand, 'Hand tool: drag to pan until you press it again or Esc'],
    ],
  },
  {
    title: 'Go to',
    rows: [
      [`${M} + \\`, 'Show or hide the sidebar'],
      [`${M} + Shift + \\`, 'Show or hide the card folders (on the Cards screen)'],
      [`${M} + P`, 'Command palette'],
      [`${M} + O  /  ${M} + K`, 'Quick switcher: find a page, or ask'],
      [`${M} + ${ALT} + D`, 'Today’s page'],
      ['?', 'This list'],
    ],
  },
  ];
}
