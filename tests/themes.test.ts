import { describe, expect, it } from 'vitest';
import {
  activeTheme, cleanCustom, cleanPalette, contrast, DEFAULT_CUSTOM, isReadable, luminance, mix, parseHex, PRESETS, readableOn, themeVars, toHex, VAR_NAMES,
} from '../src/lib/themes';

describe('colour maths', () => {
  it('round-trips hex', () => {
    expect(toHex(parseHex('#12ab9f'))).toBe('#12ab9f');
    expect(toHex([300, -5, 0.4])).toBe('#ff0000');
  });
  it('mixes', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#102030', '#ffffff', 0)).toBe('#102030');
  });
  it('measures contrast', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(readableOn('#ffffff')).toBe('#10151c');
    expect(readableOn('#101010')).toBe('#ffffff');
  });
});

describe('themes', () => {
  it('derives every variable from four colours', () => {
    const v = themeVars(DEFAULT_CUSTOM);
    expect(Object.keys(v).sort()).toEqual([...VAR_NAMES].sort());
    expect(v['--sheet']).toBe('#ffffff');
    expect(v['--accent-ink']).toBe('#ffffff');
  });
  it('ships presets that are readable and have unique ids', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) expect(isReadable(p), p.id).toBe(true);
    expect(PRESETS.some((p) => p.base === 'dark')).toBe(true);
    expect(PRESETS.some((p) => p.base === 'light')).toBe(true);
  });
  it('flags unreadable custom colours', () => {
    expect(isReadable({ ...DEFAULT_CUSTOM, ink: '#eeeeee' })).toBe(false);
  });
  it('cleans stored values', () => {
    expect(cleanPalette('nord')).toBe('nord');
    expect(cleanPalette('neon')).toBe('default');
    expect(cleanPalette(null)).toBe('default');
    expect(cleanCustom(null)).toEqual(DEFAULT_CUSTOM);
    expect(cleanCustom('not json')).toEqual(DEFAULT_CUSTOM);
    expect(cleanCustom(JSON.stringify({ base: 'dark', desk: '#ABCDEF', ink: 'red', accent: '#000000' }))).toEqual({
      base: 'dark', desk: '#abcdef', sheet: DEFAULT_CUSTOM.sheet, ink: DEFAULT_CUSTOM.ink, accent: '#000000',
    });
  });
  it('picks the active theme', () => {
    expect(activeTheme('default', DEFAULT_CUSTOM)).toBeNull();
    expect(activeTheme('nord', DEFAULT_CUSTOM)?.base).toBe('dark');
    expect(activeTheme('custom', { ...DEFAULT_CUSTOM, accent: '#112233' })?.accent).toBe('#112233');
  });
});

import { loadPrefs, setCustomTheme, setPalette, usePrefs } from '../src/store/prefs';

describe('theme settings are remembered', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { m, getSetting: async (k: string) => m.get(k) ?? null, setSetting: async (k: string, v: string | null) => void (v === null ? m.delete(k) : m.set(k, v)) };
  };
  it('saves and reloads the palette and custom colours', async () => {
    const st = store();
    setPalette('nord', st);
    expect(usePrefs.getState().palette).toBe('nord');
    setCustomTheme({ ...DEFAULT_CUSTOM, base: 'dark', accent: '#ff00aa' }, st);
    expect(usePrefs.getState().palette).toBe('custom');
    await Promise.resolve();
    usePrefs.setState({ palette: 'default', custom: DEFAULT_CUSTOM });
    await loadPrefs(st);
    expect(usePrefs.getState().palette).toBe('custom');
    expect(usePrefs.getState().custom.accent).toBe('#ff00aa');
    setPalette('default', st);
    expect(st.m.has('ui.palette')).toBe(false);
  });
  it('ignores a palette it does not know (for example from a newer version)', async () => {
    const st = store();
    st.m.set('ui.palette', 'hologram');
    await loadPrefs(st);
    expect(usePrefs.getState().palette).toBe('default');
  });
});
