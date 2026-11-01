import { create } from 'zustand';
import type { NoteColor } from '../types';
import { cleanColor } from '../lib/colors';
import { cleanName, cleanProfileColor, cleanTheme, cleanTrashDays, DEFAULT_TRASH_DAYS, type ProfileColor, type Theme } from '../lib/settings';

const STICKY_KEY = 'ui.stickyColor';
const DAILY_KEY = 'daily.templateId';
const THEME_KEY = 'ui.theme';
const NAME_KEY = 'profile.name';
const PROFILE_COLOR_KEY = 'profile.color';
const SNAP_KEY = 'editor.snap';
const TRASH_KEY = 'trash.days';
const AUTO_SYNC_KEY = 'sync.auto';

export interface Prefs {
  stickyColor: NoteColor | null;
  /** null = the built-in Daily page template, 'none' = a blank page, otherwise a template's id. */
  dailyTemplate: string | null;
  theme: Theme;
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
export function applyTheme(theme: Theme) {
  const root = typeof document === 'undefined' ? undefined : document.documentElement;
  if (!root) return; // tests run without a page
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export async function loadPrefs(storage: SettingsStore) {
  const get = (k: string) => storage.getSetting(k).catch(() => null);
  const [sticky, daily, theme, name, color, snap, trash, auto] = await Promise.all(
    [STICKY_KEY, DAILY_KEY, THEME_KEY, NAME_KEY, PROFILE_COLOR_KEY, SNAP_KEY, TRASH_KEY, AUTO_SYNC_KEY].map(get),
  );
  usePrefs.setState({
    stickyColor: cleanColor(sticky),
    dailyTemplate: daily || null,
    theme: cleanTheme(theme),
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
