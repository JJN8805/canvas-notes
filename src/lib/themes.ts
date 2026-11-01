/**
 * Colour themes. A theme is four colours (background, surface, text, accent) and whether it is a light or a dark theme;
 * every other colour the app uses is worked out from those, so a custom theme only needs four pickers.
 * Themes are a device setting: they are never synced, and exports always stay light.
 */

export type Base = 'light' | 'dark';

export interface ThemeColors {
  base: Base;
  /** The area behind the page. */
  desk: string;
  /** Cards, the sidebar and dialogs. */
  sheet: string;
  ink: string;
  accent: string;
}

export interface Preset extends ThemeColors {
  id: string;
  label: string;
}

export const PRESETS: Preset[] = [
  { id: 'sepia', label: 'Sepia', base: 'light', desk: '#eadfc8', sheet: '#f7f0e0', ink: '#3b2f1e', accent: '#a0522d' },
  { id: 'rose', label: 'Rosé', base: 'light', desk: '#f3e3e8', sheet: '#fff8fa', ink: '#3a2430', accent: '#c2417a' },
  { id: 'mint', label: 'Mint', base: 'light', desk: '#dcece6', sheet: '#f6fcf9', ink: '#1c3a31', accent: '#12805f' },
  { id: 'nord', label: 'Nord', base: 'dark', desk: '#2e3440', sheet: '#3b4252', ink: '#eceff4', accent: '#88c0d0' },
  { id: 'midnight', label: 'Midnight', base: 'dark', desk: '#05070d', sheet: '#0d1220', ink: '#dfe6f5', accent: '#6c8cff' },
  { id: 'forest', label: 'Forest', base: 'dark', desk: '#121a14', sheet: '#1b261e', ink: '#e1ede3', accent: '#7fc77f' },
];

export const DEFAULT_PALETTE = 'default';
export const CUSTOM_PALETTE = 'custom';

export const DEFAULT_CUSTOM: ThemeColors = { base: 'light', desk: '#e8ecf0', sheet: '#ffffff', ink: '#17202a', accent: '#2b47c9' };

/* ---------- colour maths ---------- */

type RGB = [number, number, number];

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export function parseHex(hex: string): RGB {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

export const toHex = ([r, g, b]: RGB): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** `t` of the way from `a` to `b` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white text, whichever reads better on `bg`. */
export const readableOn = (bg: string): string => (contrast(bg, '#ffffff') >= contrast(bg, '#10151c') ? '#ffffff' : '#10151c');

/* ---------- from four colours to the app's variables ---------- */

/** The CSS variables a theme sets. Everything not listed (note colours, group colours) comes from the base look. */
export function themeVars(t: ThemeColors): Record<string, string> {
  const dark = t.base === 'dark';
  return {
    '--desk': t.desk,
    '--sheet': t.sheet,
    '--ink': t.ink,
    '--graphite': mix(t.ink, t.sheet, 0.4),
    '--rule': mix(t.sheet, t.ink, 0.16),
    '--dot': mix(t.desk, t.ink, 0.2),
    '--hover': mix(t.sheet, t.ink, 0.07),
    '--accent': t.accent,
    '--accent-ink': readableOn(t.accent),
    '--accent-soft': mix(t.sheet, t.accent, 0.18),
    '--c-ultra': t.accent,
    '--code-bg': dark ? mix(t.desk, '#000000', 0.4) : '#1d2330',
    '--bar-bg': t.ink,
    '--bar-ink': t.desk,
    '--tab-ink': t.desk,
  };
}

export const VAR_NAMES = Object.keys(themeVars(DEFAULT_CUSTOM));

/* ---------- reading stored values ---------- */

export const paletteIds = (): string[] => [DEFAULT_PALETTE, ...PRESETS.map((p) => p.id), CUSTOM_PALETTE];
export const cleanPalette = (v: unknown): string => (typeof v === 'string' && paletteIds().includes(v) ? v : DEFAULT_PALETTE);

export function cleanCustom(v: unknown): ThemeColors {
  let o: unknown = v;
  if (typeof v === 'string') {
    try {
      o = JSON.parse(v);
    } catch {
      o = null;
    }
  }
  const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const pick = (k: 'desk' | 'sheet' | 'ink' | 'accent') => (isHex(r[k]) ? (r[k] as string).toLowerCase() : DEFAULT_CUSTOM[k]);
  return { base: r.base === 'dark' ? 'dark' : 'light', desk: pick('desk'), sheet: pick('sheet'), ink: pick('ink'), accent: pick('accent') };
}

/** The colours of the chosen palette, or null for the default look (which follows the Light / Dark / system mode). */
export function activeTheme(palette: string, custom: ThemeColors): ThemeColors | null {
  if (palette === CUSTOM_PALETTE) return custom;
  return PRESETS.find((p) => p.id === palette) ?? null;
}

/** Whether a theme's text is comfortably readable on its surface (WCAG AA, 4.5:1). */
export const isReadable = (t: ThemeColors): boolean => contrast(t.ink, t.sheet) >= 4.5 && contrast(t.ink, t.desk) >= 4.5;
