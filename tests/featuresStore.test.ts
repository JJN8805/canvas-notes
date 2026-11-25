import { beforeEach, describe, expect, it } from 'vitest';
import { PROFILES } from '../src/lib/features';
import { applyProfile, currentProfile, featureOn, loadFeatures, setFeature, useFeatures } from '../src/store/features';
import { loadAddons, setAddonEnabled, useAddons } from '../src/addons/store';

/** A settings store that remembers in memory. */
const settings = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getSetting: async (k: string) => data.get(k) ?? null,
    setSetting: async (k: string, v: string | null) => void (v === null ? data.delete(k) : data.set(k, v)),
  };
};

beforeEach(() => {
  useFeatures.setState({ disabled: [], loaded: false });
  useAddons.setState({ enabled: [], loaded: {}, loading: [], errors: {}, panel: null });
});

describe('the stored feature choice', () => {
  it('a first start has everything on, and Workspace running', async () => {
    const s = settings();
    await loadFeatures(s);
    expect(useFeatures.getState().disabled).toEqual([]);
    await loadAddons(s);
    expect(useAddons.getState().enabled).toEqual(['office']);
    expect(currentProfile()).toBe('everything');
  });
  it('reads a saved choice, ignoring names it does not know', async () => {
    await loadFeatures(settings({ 'features.disabled': '["journal","from-the-future","cards"]' }));
    expect(useFeatures.getState().disabled).toEqual(['journal', 'cards']);
    expect(featureOn('journal')).toBe(false);
    expect(featureOn('tags')).toBe(true);
  });
  it('a saved "Workspace off" stays off after a restart', async () => {
    const s = settings({ 'addons.enabled': '[]', 'addons.workspaceDefaulted': '1' });
    await loadAddons(s);
    expect(useAddons.getState().enabled).toEqual([]);
  });
  it('a list saved before Workspace was on by default gets it once, and turning it off later sticks', async () => {
    const s = settings({ 'addons.enabled': '["ocr","ai"]' });
    await loadAddons(s);
    expect(useAddons.getState().enabled).toEqual(['ocr', 'ai', 'office']);
    expect(JSON.parse(s.data.get('addons.enabled')!)).toEqual(['ocr', 'ai', 'office']);
    await setAddonEnabled('office', false, s);
    await loadAddons(s);
    expect(useAddons.getState().enabled).toEqual(['ocr', 'ai']);
  });
  it('one switch is saved, and a feature that needs another goes with it', async () => {
    const s = settings();
    useAddons.setState({ enabled: ['office'] });
    await setFeature('links', false, s);
    expect(JSON.parse(s.data.get('features.disabled')!)).toEqual(['links']);
    expect(featureOn('links')).toBe(false);
    expect(featureOn('graph')).toBe(false);
    await setFeature('links', true, s);
    expect(featureOn('graph')).toBe(true);
    expect(JSON.parse(s.data.get('features.disabled')!)).toEqual([]);
    expect(currentProfile()).toBe('everything');
  });
  it('a ready-made set switches the features and Workspace together, and is recognised again', async () => {
    const s = settings();
    for (const p of PROFILES) {
      await applyProfile(p.id, s);
      expect(useAddons.getState().enabled.includes('office')).toBe(p.workspace);
      expect(currentProfile()).toBe(p.id);
    }
    await applyProfile('documents', s);
    expect(featureOn('sheet')).toBe(true);
    expect(featureOn('slides')).toBe(false);
    expect(featureOn('canvas')).toBe(false);
    expect(JSON.parse(s.data.get('addons.enabled')!)).toEqual(['office']);
  });
});
