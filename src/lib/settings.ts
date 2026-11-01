/** Rules for the user's settings: what values are allowed, and how stored text turns back into them. */

export type Theme = 'system' | 'light' | 'dark';
export const THEMES: Theme[] = ['system', 'light', 'dark'];

export const TRASH_CHOICES = [7, 30, 90] as const;
export const DEFAULT_TRASH_DAYS = 30;

/** Profile colours: the same palette names the groups use, so they follow the light and dark theme. */
export const PROFILE_COLORS = ['ultra', 'teal', 'ochre', 'plum', 'moss', 'brick', 'slate'] as const;
export type ProfileColor = (typeof PROFILE_COLORS)[number];
export const MAX_NAME = 40;

export const cleanTheme = (v: unknown): Theme => (THEMES.includes(v as Theme) ? (v as Theme) : 'system');

export function cleanTrashDays(v: unknown): number {
  const n = Number(v);
  return (TRASH_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_TRASH_DAYS;
}

export const cleanProfileColor = (v: unknown): ProfileColor => (PROFILE_COLORS.includes(v as ProfileColor) ? (v as ProfileColor) : 'ultra');

export const cleanName = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '');

/** Up to two capital letters for the avatar: "Ada Lovelace" → "AL", "ada" → "A", "" → "". */
export function initials(name: string): string {
  const words = cleanName(name).split(' ').filter(Boolean);
  if (!words.length) return '';
  const letters = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return letters.map((w) => Array.from(w)[0].toUpperCase()).join('');
}

/** Whether the app is drawn dark, given the chosen theme and the system's preference. */
export const isDarkTheme = (theme: Theme, systemDark: boolean): boolean => (theme === 'system' ? systemDark : theme === 'dark');
