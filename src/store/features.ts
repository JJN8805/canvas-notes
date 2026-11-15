/** Which features are switched off: kept in the `features.disabled` setting (and, on a first start, taken from the build's profile). */
import { useCallback } from 'react';
import { create } from 'zustand';
import { buildProfile, effectiveOff, isFeatureOn, parseDisabled, profileById, profileOf, type FeatureId, type ProfileId } from '../lib/features';
import { setAddonEnabled, useAddons } from '../addons/store';

const KEY = 'features.disabled';

interface SettingsStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
}

export const useFeatures = create<{ disabled: FeatureId[]; loaded: boolean }>(() => ({ disabled: buildProfile().off, loaded: false }));

/** At start-up: the saved choice, or the build's profile when nothing is saved yet. */
export async function loadFeatures(storage: SettingsStore): Promise<void> {
  const raw = await storage.getSetting(KEY).catch(() => null);
  useFeatures.setState({ disabled: parseDisabled(raw, buildProfile().off), loaded: true });
}

/** Whether a feature is on, for code that isn't a component. */
export const featureOn = (id: FeatureId): boolean => isFeatureOn(useFeatures.getState().disabled, id);

/** Whether a feature is on, re-rendering the component when that changes. */
export function useFeature(id: FeatureId): boolean {
  return useFeatures(useCallback((s) => isFeatureOn(s.disabled, id), [id]));
}

async function save(storage: SettingsStore, disabled: FeatureId[]) {
  useFeatures.setState({ disabled });
  await storage.setSetting(KEY, JSON.stringify(disabled)).catch(() => {});
}

export async function setFeature(id: FeatureId, on: boolean, storage: SettingsStore): Promise<void> {
  const cur = new Set(useFeatures.getState().disabled);
  if (on) cur.delete(id);
  else cur.add(id);
  await save(storage, [...cur]);
}

/** Switch to a ready-made set: its features on or off, and the Workspace add-on to match. */
export async function applyProfile(id: ProfileId, storage: SettingsStore): Promise<void> {
  const p = profileById(id);
  if (!p) return;
  await save(storage, [...p.off]);
  await setAddonEnabled('office', p.workspace, storage);
}

/** The ready-made set the switches match, or 'custom'. */
export const currentProfile = (): ProfileId | 'custom' => profileOf(useFeatures.getState().disabled, !!useAddons.getState().enabled.includes('office'));

export { effectiveOff };
