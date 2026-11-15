import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { APP_NAME, buildInfo, describeEnvironment, diagnosticsText, formatBuildDate } from '../src/lib/appInfo';
import { CHANGELOG, latestRelease } from '../src/lib/changelog';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('release hygiene', () => {
  const pkg = JSON.parse(read('package.json')).version as string;
  it('package.json, tauri.conf.json and Cargo.toml say the same version', () => {
    expect(JSON.parse(read('src-tauri/tauri.conf.json')).version).toBe(pkg);
    expect(/^version\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1]).toBe(pkg);
  });
  it('the newest changelog entry is the current version, and every entry is well formed', () => {
    expect(latestRelease().version).toBe(pkg);
    for (const r of CHANGELOG) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.items.length).toBeGreaterThan(0);
    }
    expect(new Set(CHANGELOG.map((r) => r.version)).size).toBe(CHANGELOG.length);
  });
  it('without a Vite build, buildInfo still gives the package version', () => {
    expect(buildInfo().version).toBe(pkg);
  });
});

describe('describeEnvironment', () => {
  it('names the system and engine', () => {
    expect(describeEnvironment('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toEqual({ os: 'Linux', engine: 'WebKit / Safari 17.0' });
    expect(describeEnvironment('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0').engine).toBe('Edge / WebView2 126');
    expect(describeEnvironment('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36')).toEqual({ os: 'Android', engine: 'Chromium 125' });
    expect(describeEnvironment('')).toEqual({ os: 'Unknown', engine: 'Unknown' });
  });
});

describe('formatBuildDate', () => {
  it('formats a date and copes with a missing one', () => {
    expect(formatBuildDate('2026-11-09T10:00:00Z', 'en-GB')).toMatch(/2026/);
    expect(formatBuildDate('')).toBe('Unknown');
    expect(formatBuildDate('nonsense')).toBe('Unknown');
  });
});

describe('diagnosticsText', () => {
  const text = diagnosticsText({
    build: { version: '1.2.3', commit: 'abc1234', builtAt: '2026-11-09T10:00:00.000Z', mode: 'production' },
    env: { os: 'Linux', engine: 'WebKit 605' },
    storage: 'desktop',
    counts: { pages: 12, groups: 3, boxes: 80, trash: 1 },
    language: 'en-GB',
    addons: ['ai'],
  });
  it('has the facts a bug report needs', () => {
    expect(text).toContain(`${APP_NAME} 1.2.3 (abc1234)`);
    expect(text).toContain('12 pages, 3 groups, 80 boxes, 1 in Trash');
    expect(text).toContain('Add-ons on: ai');
    expect(text.split('\n')).toHaveLength(7);
  });
  it('carries nothing from the notes: no paths, titles or text fields exist in its input', () => {
    expect(text).not.toMatch(/\/home\/|C:\\|password|pairing/i);
  });
});
