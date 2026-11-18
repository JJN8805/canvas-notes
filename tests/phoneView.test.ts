import { describe, expect, it } from 'vitest';
import { fitWidthStart, showsNewPage, tabOf } from '../src/lib/phoneView';

describe('where a page starts on a phone', () => {
  const content = (w: number) => ({ minX: 100, minY: 50, maxX: 100 + w, maxY: 900 });
  it('fits a narrow page to the screen width, from its top left', () => {
    expect(fitWidthStart(content(300), 393)).toEqual({ zoom: 1, x: 84, y: 34 }); // already fits: never bigger than 1
    const f = fitWidthStart(content(600), 393);
    expect(f.zoom).toBeCloseTo(393 / 632, 2);
    expect(f).toMatchObject({ x: 84, y: 34 });
  });
  it('never goes below readable (the rest is a swipe away)', () => {
    expect(fitWidthStart(content(5000), 393).zoom).toBe(0.5);
    expect(fitWidthStart(content(5000), 393, 16, 0.6).zoom).toBe(0.6);
  });
  it('copes with an empty or one-point page', () => {
    expect(fitWidthStart({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 393).zoom).toBe(1);
  });
});

describe('phone tabs', () => {
  it('puts each library screen under a tab', () => {
    for (const k of ['all', 'group', 'groups', 'ungrouped', 'tag', 'tags']) expect(tabOf(k)).toBe('pages');
    expect(tabOf('journal')).toBe('journal');
    expect(tabOf('cards')).toBe('cards');
    for (const k of ['templates', 'trash', 'addon', 'whatever']) expect(tabOf(k)).toBe('more');
  });
  it('floats "new page" only over lists of pages', () => {
    expect(showsNewPage('all')).toBe(true);
    for (const k of ['trash', 'cards', 'journal', 'groups', 'tags', 'templates']) expect(showsNewPage(k)).toBe(false);
  });
});
