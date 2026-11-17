import { describe, expect, it } from 'vitest';
import { MAX_FAVORITES, favoritePages, parseFavorites, recentPages, toggleFavorite } from '../src/lib/favorites';
import type { Page } from '../src/types';

const page = (id: string, updated: number) => ({ id, title: id, updated }) as Page;

describe('favorites', () => {
  it('repairs what is stored: safe ids only, no repeats, a limit, nothing for junk', () => {
    expect(parseFavorites('["a","b","a"]')).toEqual(['a', 'b']);
    expect(parseFavorites('["../x","a b",5,null,"ok"]')).toEqual(['ok']);
    expect(parseFavorites('not json')).toEqual([]);
    expect(parseFavorites('{"a":1}')).toEqual([]);
    expect(parseFavorites(null)).toEqual([]);
    expect(parseFavorites(JSON.stringify(Array.from({ length: 100 }, (_, i) => `p${i}`)))).toHaveLength(MAX_FAVORITES);
  });
  it('stars and un-stars', () => {
    expect(toggleFavorite(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleFavorite(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('lists starred pages that still exist, in the order they were starred', () => {
    expect(favoritePages(['b', 'gone', 'a'], [page('a', 1), page('b', 2)]).map((p) => p.id)).toEqual(['b', 'a']);
  });
  it('lists the latest edited pages, newest first, without the starred ones', () => {
    const all = [page('a', 5), page('b', 9), page('c', 1), page('d', 7)];
    expect(recentPages(all, [], 3).map((p) => p.id)).toEqual(['b', 'd', 'a']);
    expect(recentPages(all, ['b'], 2).map((p) => p.id)).toEqual(['d', 'a']);
    expect(all.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']); // the input is not reordered
  });
});
