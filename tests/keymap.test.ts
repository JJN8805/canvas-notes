import { describe, expect, it } from 'vitest';
import { actionFor, cleanKeymap, DEFAULT_KEYMAP, isDefaultKeymap, KEY_ACTIONS, setKey } from '../src/lib/keymap';

describe('keymap', () => {
  it('starts as the documented defaults and finds actions by physical key', () => {
    expect(actionFor(DEFAULT_KEYMAP, 'KeyS')).toBe('sticky');
    expect(actionFor(DEFAULT_KEYMAP, 'KeyH')).toBe('hand');
    expect(actionFor(DEFAULT_KEYMAP, 'KeyZ')).toBeNull();
    expect(actionFor(DEFAULT_KEYMAP, 'Digit2')).toBeNull();
  });
  it('rebinding frees the old letter and takes the new one', () => {
    const r = setKey(DEFAULT_KEYMAP, 'sticky', 'n');
    expect(r.ok && r.map.sticky).toBe('N');
    if (r.ok) {
      expect(actionFor(r.map, 'KeyN')).toBe('sticky');
      expect(actionFor(r.map, 'KeyS')).toBeNull();
      expect(isDefaultKeymap(r.map)).toBe(false);
    }
  });
  it('refuses a letter another action has, and anything that is not a letter', () => {
    const clash = setKey(DEFAULT_KEYMAP, 'sticky', 't');
    expect(clash.ok).toBe(false);
    expect(!clash.ok && clash.error).toMatch(/Text box/);
    expect(setKey(DEFAULT_KEYMAP, 'sticky', '5').ok).toBe(false);
    expect(setKey(DEFAULT_KEYMAP, 'sticky', 'ab').ok).toBe(false);
  });
  it('repairs a stored keymap: junk, missing entries and clashes', () => {
    expect(cleanKeymap(null)).toEqual(DEFAULT_KEYMAP);
    expect(cleanKeymap('not json')).toEqual(DEFAULT_KEYMAP);
    expect(cleanKeymap(JSON.stringify({ sticky: 'q' })).sticky).toBe('Q');
    const clashed = cleanKeymap({ sticky: 'T', text: 'T' });
    const letters = KEY_ACTIONS.map((a) => clashed[a.id]);
    expect(new Set(letters).size).toBe(letters.length); // no two actions share a key
    expect(letters.every((l) => /^[A-Z]$/.test(l))).toBe(true);
  });
});
