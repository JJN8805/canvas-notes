import { describe, expect, it } from 'vitest';
import { cleanName, cleanProfileColor, cleanTheme, cleanTrashDays, initials, isDarkTheme } from '../src/lib/settings';
import { daysLeft } from '../src/lib/history';

describe('settings values', () => {
  it('falls back to the default for anything unrecognised', () => {
    expect(cleanTheme('dark')).toBe('dark');
    expect(cleanTheme('purple')).toBe('system');
    expect(cleanTheme(null)).toBe('system');
    expect(cleanTrashDays('90')).toBe(90);
    expect(cleanTrashDays('5')).toBe(30);
    expect(cleanTrashDays(null)).toBe(30);
    expect(cleanProfileColor('plum')).toBe('plum');
    expect(cleanProfileColor('neon')).toBe('ultra');
  });

  it('tidies and limits names', () => {
    expect(cleanName('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(cleanName('x'.repeat(100))).toHaveLength(40);
    expect(cleanName(42)).toBe('');
  });

  it('makes initials from the first and last word', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('ada')).toBe('A');
    expect(initials('Mary Jane Watson')).toBe('MW');
    expect(initials('  ')).toBe('');
    expect(initials('émile zola')).toBe('ÉZ');
  });

  it('decides dark from the theme and the system', () => {
    expect(isDarkTheme('system', true)).toBe(true);
    expect(isDarkTheme('system', false)).toBe(false);
    expect(isDarkTheme('light', true)).toBe(false);
    expect(isDarkTheme('dark', false)).toBe(true);
  });

  it('counts Trash days left against the chosen retention', () => {
    const D = 24 * 3600_000;
    expect(daysLeft(0, 10 * D, 7)).toBe(0);
    expect(daysLeft(0, 10 * D, 90)).toBe(80);
  });
});
