import { create } from 'zustand';
import type { NoteColor } from '../types';
import { cleanColor } from '../lib/colors';

const STICKY_KEY = 'ui.stickyColor';
const DAILY_KEY = 'daily.templateId';

/**
 * Small settings that are remembered between sessions on this device.
 * `dailyTemplate`: null = the built-in Daily page template, 'none' = a blank page, otherwise a template's id.
 */
export const usePrefs = create<{ stickyColor: NoteColor | null; dailyTemplate: string | null }>(() => ({ stickyColor: null, dailyTemplate: null }));

interface SettingsStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
}

export async function loadPrefs(storage: SettingsStore) {
  const [sticky, daily] = await Promise.all([storage.getSetting(STICKY_KEY).catch(() => null), storage.getSetting(DAILY_KEY).catch(() => null)]);
  usePrefs.setState({ stickyColor: cleanColor(sticky), dailyTemplate: daily || null });
}

/** The colour the next sticky starts with: the last one picked for a sticky. */
export function rememberStickyColor(color: NoteColor, storage?: SettingsStore | null) {
  if (usePrefs.getState().stickyColor === color) return;
  usePrefs.setState({ stickyColor: color });
  void storage?.setSetting(STICKY_KEY, color).catch(() => {});
}

/** Chooses which template new daily pages start from (see `usePrefs`). */
export function setDailyTemplate(value: string | null, storage?: SettingsStore | null) {
  if (usePrefs.getState().dailyTemplate === value) return;
  usePrefs.setState({ dailyTemplate: value });
  void storage?.setSetting(DAILY_KEY, value).catch(() => {});
}
