import { Extension, Mark, type Editor } from '@tiptap/react';
import { safeStyle } from '../../lib/richStyle';

/**
 * Formatting beyond the basics, kept in the text itself as inline styles (so it travels with the page, shows in thumbnails and exports,
 * and an older app version simply shows plain text): paragraph alignment, font size, text colour and highlight.
 * `lib/richStyle.ts` decides which styles are allowed.
 */

const ALIGN_TYPES = ['paragraph', 'heading'];

export const TextAlign = Extension.create({
  name: 'textAlign',
  addGlobalAttributes() {
    return [
      {
        types: ALIGN_TYPES,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el) => safeStyle(el.getAttribute('style') ?? '').match(/text-align: (\w+)/)?.[1] ?? null,
            renderHTML: (attrs) => (attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {}),
          },
        },
      },
    ];
  },
});

/** A mark that is one inline style on a span. */
const styleMark = (name: string, cssProp: string) =>
  Mark.create({
    name,
    addAttributes() {
      return {
        value: {
          default: null,
          parseHTML: (el) => (safeStyle(el.getAttribute('style') ?? '').match(new RegExp(`(?:^|; )${cssProp}: ([^;]+)`))?.[1] ?? null),
          renderHTML: (attrs) => (attrs.value ? { style: `${cssProp}: ${attrs.value}` } : {}),
        },
      };
    },
    parseHTML() {
      return [
        {
          tag: 'span',
          consuming: false, // a span can carry several of these at once
          getAttrs: (el) => (new RegExp(`(?:^|; )${cssProp}: `).test(safeStyle((el as HTMLElement).getAttribute('style') ?? '')) ? {} : false),
        },
      ];
    },
    renderHTML({ HTMLAttributes }) {
      return ['span', HTMLAttributes, 0];
    },
  });

export const FontSize = styleMark('fontSize', 'font-size');
export const TextColor = styleMark('textColor', 'color');
export const Highlight = styleMark('highlight', 'background-color');

/** Added to every full text box (stickies keep it simple). */
export const richExtensions = [TextAlign, FontSize, TextColor, Highlight];

export type Align = 'left' | 'center' | 'right' | 'justify';

export function setAlign(editor: Editor, align: Align) {
  const chain = editor.chain().focus();
  for (const t of ALIGN_TYPES) chain.updateAttributes(t, { textAlign: align === 'left' ? null : align });
  chain.run();
}

export const alignOfSelection = (editor: Editor): Align => {
  for (const t of ALIGN_TYPES) {
    const a = editor.getAttributes(t).textAlign as Align | null | undefined;
    if (a) return a;
  }
  return 'left';
};

/** Sets (or, with null, clears) a font size such as "24px" on the selection. */
export function setFontSize(editor: Editor, size: string | null) {
  const c = editor.chain().focus();
  if (size) c.setMark('fontSize', { value: size }).run();
  else c.unsetMark('fontSize').run();
}

export function setTextColor(editor: Editor, color: string | null) {
  const c = editor.chain().focus();
  if (color) c.setMark('textColor', { value: color }).run();
  else c.unsetMark('textColor').run();
}

export function setHighlight(editor: Editor, color: string | null) {
  const c = editor.chain().focus();
  if (color) c.setMark('highlight', { value: color }).run();
  else c.unsetMark('highlight').run();
}
