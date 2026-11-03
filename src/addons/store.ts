import { create } from 'zustand';
import { ADDONS, isAddOnId } from './registry';
import type { AddOnId, AddOnModule, BlockAction, CardPictureSource } from './types';
import type { Block } from '../types';
import type { Command } from '../components/nav/commands';

const KEY = 'addons.enabled';

interface SettingsStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
}

interface AddonsState {
  enabled: AddOnId[];
  /** Add-ons whose module has been fetched and is running. */
  loaded: Partial<Record<AddOnId, AddOnModule>>;
  loading: AddOnId[];
  errors: Partial<Record<AddOnId, string>>;
  /** The add-on whose side panel is open. */
  panel: AddOnId | null;
}

export const useAddons = create<AddonsState>(() => ({ enabled: [], loaded: {}, loading: [], errors: {}, panel: null }));

/** The saved list, keeping only add-ons that still exist (an older or newer app version may know different ones). */
export function parseEnabled(raw: string | null): AddOnId[] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? [...new Set(v.filter(isAddOnId))] : [];
  } catch {
    return [];
  }
}

async function load(id: AddOnId) {
  const info = ADDONS.find((a) => a.id === id);
  if (!info || useAddons.getState().loaded[id] || useAddons.getState().loading.includes(id)) return;
  useAddons.setState((s) => ({ loading: [...s.loading, id], errors: { ...s.errors, [id]: undefined } }));
  try {
    const mod = await info.load();
    // Switched off again while it was loading: don't start it.
    if (!useAddons.getState().enabled.includes(id)) return;
    useAddons.setState((s) => ({ loaded: { ...s.loaded, [id]: mod } }));
  } catch (e) {
    useAddons.setState((s) => ({ errors: { ...s.errors, [id]: e instanceof Error ? e.message : 'could not be loaded' } }));
  } finally {
    useAddons.setState((s) => ({ loading: s.loading.filter((x) => x !== id) }));
  }
}

/** At start-up: remembers which add-ons are on and loads them. */
export async function loadAddons(storage: SettingsStore) {
  const enabled = parseEnabled(await storage.getSetting(KEY).catch(() => null));
  useAddons.setState({ enabled });
  await Promise.all(enabled.map(load));
}

export async function setAddonEnabled(id: AddOnId, on: boolean, storage: SettingsStore) {
  const cur = useAddons.getState().enabled;
  const enabled = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
  useAddons.setState((s) => {
    const loaded = { ...s.loaded };
    if (!on) delete loaded[id];
    return { enabled, loaded, panel: !on && s.panel === id ? null : s.panel };
  });
  await storage.setSetting(KEY, JSON.stringify(enabled)).catch(() => {});
  if (on) await load(id);
}

export const openAddonPanel = (id: AddOnId | null) => useAddons.setState({ panel: id });

const modules = () => Object.entries(useAddons.getState().loaded) as [AddOnId, AddOnModule][];

/** Buttons the running add-ons put on a box's hover bar. */
export function blockActionsFor(block: Block, pageId: string): BlockAction[] {
  return modules().flatMap(([, m]) => m.blockActions?.(block, pageId) ?? []);
}

/** Ways the running add-ons offer to give a card its picture. */
export function cardPictureSources(): (CardPictureSource & { key: string })[] {
  return modules().flatMap(([id, m]) => (m.cardPictureSources ?? []).map((s, i) => ({ ...s, key: `${id}:${i}` })));
}

/** Palette entries from the running add-ons. */
export function addonCommands(pageId: string | null): Command[] {
  return modules().flatMap(([, m]) => m.commands?.({ pageId }) ?? []);
}
