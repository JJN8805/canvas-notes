import { create } from 'zustand';
import type { NoteColor } from '../types';
import { cleanColor } from '../lib/colors';
import { activeTheme, cleanCustom, cleanPalette, themeVars, VAR_NAMES, DEFAULT_CUSTOM, DEFAULT_PALETTE, type ThemeColors } from '../lib/themes';
import { cleanName, cleanProfileColor, cleanTheme, cleanTrashDays, DEFAULT_TRASH_DAYS, type ProfileColor, type Theme } from '../lib/settings';

const STICKY_KEY = 'ui.stickyColor';
const DAILY_KEY = 'daily.templateId';
const THEME_KEY = 'ui.theme';
const NAME_KEY = 'profile.name';
const PROFILE_COLOR_KEY = 'profile.color';
const SNAP_KEY = 'editor.snap';
const TRASH_KEY = 'trash.days';
const AUTO_SYNC_KEY = 'sync.auto';
const PALETTE_KEY = 'ui.palette';
const CUSTOM_THEME_KEY = 'ui.customTheme';

export interface Prefs {
  stickyColor: NoteColor | null;
  /** null = the built-in Daily page template, 'none' = a blank page, otherwise a template's id. */
  dailyTemplate: string | null;
  theme: Theme;
  /** The colour theme: 'default' (follows `theme`), a preset's id, or 'custom'. See lib/themes.ts. */
  palette: string;
  /** The colours of the 'custom' theme. */
  custom: ThemeColors;
  profileName: string;
  profileColor: ProfileColor;
  /** Snap to other boxes and the grid while dragging (Alt still turns it off for one drag). */
  snap: boolean;
  /** Days a deleted page stays in Trash. */
  trashDays: number;
  /** Sync in the background (on opening, every two minutes, after edits) rather than only on request. */
  autoSync: boolean;
}

/** Small settings that are remembered between sessions on this device. */
export const usePrefs = create<Prefs>(() => ({
  stickyColor: null,
  dailyTemplate: null,
  theme: 'system',
  palette: DEFAULT_PALETTE,
  custom: DEFAULT_CUSTOM,
  profileName: '',
  profileColor: 'ultra',
  snap: true,
  trashDays: DEFAULT_TRASH_DAYS,
  autoSync: true,
}));

interface SettingsStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
}

/** Puts the chosen theme on the page: the stylesheet follows the system unless `data-theme` says otherwise. */
export function applyTheme(theme: Theme, palette = usePrefs.getState().palette, custom = usePrefs.getState().custom) {
  const root = typeof document === 'undefined' ? undefined : document.documentElement;
  if (!root) return; // tests run without a page
  const colors = activeTheme(palette, custom);
  // A colour theme is either light or dark itself; the default look follows the chosen mode.
  const mode = colors ? colors.base : theme;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
  for (const name of VAR_NAMES) root.style.removeProperty(name);
  if (colors) for (const [k, v] of Object.entries(themeVars(colors))) root.style.setProperty(k, v);
}

export async function loadPrefs(storage: SettingsStore) {
  const get = (k: string) => storage.getSetting(k).catch(() => null);
  const [sticky, daily, theme, name, color, snap, trash, auto, palette, custom] = await Promise.all(
    [STICKY_KEY, DAILY_KEY, THEME_KEY, NAME_KEY, PROFILE_COLOR_KEY, SNAP_KEY, TRASH_KEY, AUTO_SYNC_KEY, PALETTE_KEY, CUSTOM_THEME_KEY].map(get),
  );
  usePrefs.setState({
    stickyColor: cleanColor(sticky),
    dailyTemplate: daily || null,
    theme: cleanTheme(theme),
    palette: cleanPalette(palette),
    custom: cleanCustom(custom),
    profileName: cleanName(name),
    profileColor: cleanProfileColor(color),
    snap: snap !== 'off',
    trashDays: cleanTrashDays(trash),
    autoSync: auto !== 'off',
  });
  applyTheme(usePrefs.getState().theme);
}

/** Changes a setting now and remembers it. `null` as the stored text removes the saved value. */
function change(patch: Partial<Prefs>, key: string, stored: string | null, storage?: SettingsStore | null) {
  usePrefs.setState(patch);
  void storage?.setSetting(key, stored).catch(() => {});
}

/** The colour the next sticky starts with: the last one picked for a sticky. */
export function rememberStickyColor(color: NoteColor, storage?: SettingsStore | null) {
  if (usePrefs.getState().stickyColor === color) return;
  change({ stickyColor: color }, STICKY_KEY, color, storage);
}

/** Chooses which template new daily pages start from (see `Prefs.dailyTemplate`). */
export function setDailyTemplate(value: string | null, storage?: SettingsStore | null) {
  if (usePrefs.getState().dailyTemplate === value) return;
  change({ dailyTemplate: value }, DAILY_KEY, value, storage);
}

export function setTheme(theme: Theme, storage?: SettingsStore | null) {
  applyTheme(theme);
  change({ theme }, THEME_KEY, theme, storage);
}

/** Chooses the colour theme ('default', a preset's id, or 'custom'). */
export function setPalette(palette: string, storage?: SettingsStore | null) {
  const p = cleanPalette(palette);
  applyTheme(usePrefs.getState().theme, p);
  change({ palette: p }, PALETTE_KEY, p === DEFAULT_PALETTE ? null : p, storage);
}

/** Changes the custom theme's colours and switches to it. */
export function setCustomTheme(custom: ThemeColors, storage?: SettingsStore | null) {
  const c = cleanCustom(custom);
  usePrefs.setState({ custom: c });
  setPalette('custom', storage);
  void storage?.setSetting(CUSTOM_THEME_KEY, JSON.stringify(c)).catch(() => {});
}

export function setProfileName(name: string, storage?: SettingsStore | null) {
  const clean = cleanName(name);
  change({ profileName: clean }, NAME_KEY, clean || null, storage);
}

export function setProfileColor(color: ProfileColor, storage?: SettingsStore | null) {
  change({ profileColor: color }, PROFILE_COLOR_KEY, color, storage);
}

export function setSnap(on: boolean, storage?: SettingsStore | null) {
  change({ snap: on }, SNAP_KEY, on ? null : 'off', storage);
}

export function setTrashDays(days: number, storage?: SettingsStore | null) {
  const trashDays = cleanTrashDays(days);
  change({ trashDays }, TRASH_KEY, String(trashDays), storage);
}

export function setAutoSync(on: boolean, storage?: SettingsStore | null) {
  change({ autoSync: on }, AUTO_SYNC_KEY, on ? null : 'off', storage);
}
