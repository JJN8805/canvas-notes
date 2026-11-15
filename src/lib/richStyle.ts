/**
 * The inline styles rich text may carry (pure). Text boxes and documents can set a font size, a colour, a highlight and an
 * alignment; everything else in a `style` attribute is dropped, so pasted or synced text can never smuggle in anything else
 * (a url(), a position, a script-like value).
 */

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*(,\s*\d{1,3}\s*){2}(,\s*(0|1|0?\.\d+)\s*)?\)|[a-z]{3,20})$/i;
const SIZE = /^(\d{1,3}(\.\d{1,2})?)(px|pt|em|rem|%)$/i;
const ALIGN = /^(left|center|right|justify)$/i;
/** The words that are colours (and "transparent" etc.) as opposed to keywords such as "inherit" or "expression". */
const BAD_WORDS = /^(inherit|initial|unset|revert|expression|url|var|calc|attr|env)$/i;

/** The size in pixels that a font-size value means, or null when it is not a sensible size. */
export function sizePx(value: string): number | null {
  const m = SIZE.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const px = { px: n, pt: (n * 4) / 3, em: n * 16, rem: n * 16, '%': (n * 16) / 100 }[m[3].toLowerCase() as 'px' | 'pt' | 'em' | 'rem' | '%'];
  return px >= 6 && px <= 400 ? px : null;
}

/** The style text with only font-size, color, background-color and text-align left in, each with a value that is safe. */
export function safeStyle(css: string): string {
  const out: string[] = [];
  for (const decl of css.split(';')) {
    const at = decl.indexOf(':');
    if (at < 0) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl.slice(at + 1).trim();
    if (!value || /[\\<>{}@]|url\s*\(|expression|javascript/i.test(value)) continue;
    if (prop === 'font-size' && sizePx(value) !== null) out.push(`font-size: ${value}`);
    else if ((prop === 'color' || prop === 'background-color') && COLOR.test(value) && !BAD_WORDS.test(value)) out.push(`${prop}: ${value}`);
    else if (prop === 'text-align' && ALIGN.test(value)) out.push(`text-align: ${value.toLowerCase()}`);
  }
  return out.join('; ');
}
