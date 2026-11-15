import { describe, expect, it } from 'vitest';
import { linkText, suggestPages, wikiTrigger } from '../src/lib/pageSuggest';
import type { Page } from '../src/types';

const page = (id: string, title: string, o: Partial<Page> = {}): Page => ({ id, title, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 1, ...o });
const map = (...ps: Page[]) => Object.fromEntries(ps.map((p) => [p.id, p]));

describe('the [[ page picker', () => {
  it('applies only right after an unfinished [[', () => {
    expect(wikiTrigger('see [[')).toEqual({ query: '', length: 2 });
    expect(wikiTrigger('see [[Proj')).toEqual({ query: 'Proj', length: 6 });
    expect(wikiTrigger('see [[Done]]')).toBeNull();
    expect(wikiTrigger('a [ b')).toBeNull();
    expect(wikiTrigger('[[line\nbreak')).toBeNull();
    expect(wikiTrigger('[[' + 'x'.repeat(61))).toBeNull();
  });
  it('offers matching pages, best first, never the current page, templates, cards, daily or untitled ones', () => {
    const ps = map(
      page('a', 'Project plan', { updated: 5 }),
      page('b', 'Projects ideas', { updated: 9 }),
      page('c', 'Groceries'),
      page('me', 'Project me'),
      page('t', 'Project tpl', { kind: 'template' }),
      page('k', 'Project card', { kind: 'card' }),
      page('d', 'Project day', { dailyDate: '2026-11-01' }),
      page('u', '  '),
    );
    expect(suggestPages(ps, 'proj', 'me').map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(suggestPages(ps, '', 'me').map((p) => p.id)).toEqual(['b', 'a', 'c']); // newest first
    expect(suggestPages(ps, '', 'me', 2)).toHaveLength(2);
    expect(suggestPages(ps, 'zzz', null)).toEqual([]);
  });
  it('writes a link that brackets in a title cannot break', () => {
    expect(linkText('Plan')).toBe('[[Plan]]');
    expect(linkText('A [draft] ]]plan')).toBe('[[A draft plan]]');
  });
});
