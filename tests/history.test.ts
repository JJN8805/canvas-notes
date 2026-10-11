import { describe, expect, it } from 'vitest';
import { daysLeft, isBlankPage, shouldSnapshot, snapshotsToDrop } from '../src/lib/history';

const H = 3600_000;
const D = 24 * H;
const NOW = new Date(2026, 5, 20, 15, 0).getTime();

describe('shouldSnapshot', () => {
  it('allows the first one and then one an hour', () => {
    expect(shouldSnapshot(null, NOW)).toBe(true);
    expect(shouldSnapshot(NOW - 59 * 60_000, NOW)).toBe(false);
    expect(shouldSnapshot(NOW - H, NOW)).toBe(true);
  });
});

describe('snapshotsToDrop', () => {
  it('keeps everything from the last 48 hours', () => {
    const list = [0, 1, 2, 10, 30, 47].map((h) => ({ id: `s${h}`, taken: NOW - h * H }));
    expect(snapshotsToDrop(list, NOW)).toEqual([]);
  });

  it('keeps only the newest of each day once older than 48 hours', () => {
    const day = new Date(2026, 5, 10, 0, 0).getTime();
    const list = [
      { id: 'a', taken: day + 2 * H },
      { id: 'b', taken: day + 9 * H },
      { id: 'c', taken: day + 20 * H },
      { id: 'other-day', taken: day - D + 5 * H },
    ];
    expect(snapshotsToDrop(list, NOW).sort()).toEqual(['a', 'b']);
    // Order of the input does not matter.
    expect(snapshotsToDrop([...list].reverse(), NOW).sort()).toEqual(['a', 'b']);
  });

  it('drops everything older than 30 days', () => {
    const list = [
      { id: 'recent', taken: NOW - 29 * D },
      { id: 'old', taken: NOW - 31 * D },
    ];
    expect(snapshotsToDrop(list, NOW)).toEqual(['old']);
  });
});

describe('isBlankPage and daysLeft', () => {
  it('knows an empty page', () => {
    expect(isBlankPage({ title: '', tags: [], blocks: [], arrows: [] })).toBe(true);
    expect(isBlankPage({ title: 'x', tags: [], blocks: [], arrows: [] })).toBe(false);
    expect(isBlankPage({ title: '', tags: [], blocks: [{}], arrows: [] })).toBe(false);
  });

  it('counts the days before a trashed page is purged', () => {
    expect(daysLeft(NOW, NOW)).toBe(30);
    expect(daysLeft(NOW - 10 * D, NOW)).toBe(20);
    expect(daysLeft(NOW - 45 * D, NOW)).toBe(0);
  });
});
