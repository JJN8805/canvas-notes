import { describe, expect, it } from 'vitest';
import { entrySnippet, filterEntries, isJournalPage, journalEntries, longDate, monthHeading, neighbourEntries, templateLines, turnDirection } from '../src/lib/journal';
import { attendancePagesOf, libraryPages, listedPages } from '../src/lib/pages';
import type { Block, Page } from '../src/types';

const text = (html: string, y = 0, x = 0): Block => ({ id: 't' + html + y + x, type: 'text', x, y, w: 1, h: 1, z: 1, html }) as Block;
const page = (id: string, extra: Partial<Page> = {}): Page => ({ id, title: id, groupId: null, tags: [], blocks: [], arrows: [], created: 1, updated: 1, rev: 0, ...extra });
const day = (date: string, blocks: Block[] = [], extra: Partial<Page> = {}) => page('d' + date, { dailyDate: date, title: `day ${date}`, blocks, ...extra });

const pages: Record<string, Page> = Object.fromEntries(
  [
    day('2026-11-02', [text('<p>Went to the market</p>')]),
    day('2026-11-04', [text('<p>Second box</p>', 200), text('<h1>Big plan</h1>', 10)]),
    day('2026-10-19'),
    page('plain', { title: 'Ideas' }),
    page('tpl', { kind: 'template', dailyDate: '2026-11-03' }),
    page('card', { kind: 'card', dailyDate: '2026-11-05' }),
  ].map((p) => [p.id, p]),
);

describe('what counts as a journal page', () => {
  it('is an ordinary page that carries a valid date', () => {
    expect(isJournalPage(day('2026-11-02'))).toBe(true);
    expect(isJournalPage(page('plain'))).toBe(false);
    expect(isJournalPage(page('x', { dailyDate: 'yesterday' }))).toBe(false);
    expect(isJournalPage(page('x', { dailyDate: null }))).toBe(false);
    expect(isJournalPage(page('x', { kind: 'template', dailyDate: '2026-11-03' }))).toBe(false);
    expect(isJournalPage(page('x', { kind: 'card', dailyDate: '2026-11-03' }))).toBe(false);
  });

  it('lists the days newest first, leaving out templates and cards', () => {
    expect(journalEntries(pages).map((e) => e.date)).toEqual(['2026-11-04', '2026-11-02', '2026-10-19']);
  });

  it('keeps daily pages out of the library’s own lists, but not out of the pages that search and links use', () => {
    expect(listedPages(pages).map((p) => p.id)).toEqual(['plain']);
    expect(libraryPages(pages).map((p) => p.id).sort()).toEqual(['d2026-10-19', 'd2026-11-02', 'd2026-11-04', 'plain']);
  });
});

describe('the contents of the journal', () => {
  const entries = journalEntries(pages);

  it('shows the first line of writing, top to bottom, cut to a length', () => {
    expect(entrySnippet(pages['d2026-11-02'])).toBe('Went to the market');
    expect(entrySnippet(pages['d2026-11-04'])).toBe('Big plan'); // the box nearest the top, not the first made
    expect(entrySnippet(pages['d2026-10-19'])).toBe('');
    const long = page('x', { blocks: [text('<p>' + 'word '.repeat(60) + '</p>')] });
    expect(entrySnippet(long, 20)).toBe('word word word word…'); // cut at the limit, with an ellipsis and no trailing space
    expect(entrySnippet(long, 20).length).toBeLessThanOrEqual(20);
  });

  it('skips the lines the daily template starts every page with, so days are told apart by what was written', () => {
    const tpl = page('tpl', { kind: 'template', blocks: [text('<h2>Focus</h2><p>The one thing that would make today a good day…</p>', 0), text('<h2>Notes</h2>', 300)] });
    const fromTemplate = templateLines(tpl);
    expect([...fromTemplate]).toEqual(['Focus', 'The one thing that would make today a good day…', 'Notes']);
    const untouched = page('a', { blocks: tpl.blocks.map((b) => ({ ...b, id: b.id + 'x' })) });
    const written = page('b', { blocks: [...tpl.blocks, text('<p>Walked by the river</p>', 150)] });
    expect(entrySnippet(untouched, 90, fromTemplate)).toBe(''); // nothing written yet
    expect(entrySnippet(written, 90, fromTemplate)).toBe('Walked by the river');
    expect(entrySnippet(written)).toBe('Focus'); // without the template's lines, the first line is the template's
    expect(templateLines(null).size).toBe(0);
  });

  it('finds days by their date or their words', () => {
    expect(filterEntries(entries, '').map((e) => e.date)).toEqual(['2026-11-04', '2026-11-02', '2026-10-19']);
    expect(filterEntries(entries, 'market').map((e) => e.date)).toEqual(['2026-11-02']);
    expect(filterEntries(entries, 'big PLAN').map((e) => e.date)).toEqual(['2026-11-04']);
    expect(filterEntries(entries, '2026-10').map((e) => e.date)).toEqual(['2026-10-19']);
    expect(filterEntries(entries, 'zzz')).toEqual([]);
  });

  it('finds the nearest written day either side, skipping blank days', () => {
    expect(neighbourEntries(entries, '2026-11-03')).toEqual({ earlier: '2026-11-02', later: '2026-11-04' });
    expect(neighbourEntries(entries, '2026-11-04')).toEqual({ earlier: '2026-11-02', later: null });
    expect(neighbourEntries(entries, '2026-10-01')).toEqual({ earlier: null, later: '2026-10-19' });
    expect(neighbourEntries([], '2026-11-03')).toEqual({ earlier: null, later: null });
  });
});

describe('turning pages and naming them', () => {
  it('turns forward to a later day and back to an earlier one', () => {
    expect(turnDirection('2026-11-02', '2026-11-03')).toBe(1);
    expect(turnDirection('2026-11-02', '2026-10-30')).toBe(-1);
    expect(turnDirection('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('writes a date out in full for the top of a page', () => {
    expect(longDate('2026-11-04')).toEqual({ weekday: 'Wednesday', rest: '4 November 2026' });
    expect(longDate('2028-02-29')).toEqual({ weekday: 'Tuesday', rest: '29 February 2028' });
    expect(longDate('2026-01-01')).toEqual({ weekday: 'Thursday', rest: '1 January 2026' });
    expect(monthHeading('2026-11-04')).toBe('November 2026');
  });
});

describe('attendance pages', () => {
  const att = page('att', { title: 'Attendance: Habits', blocks: [{ id: 'att-summary', type: 'table', x: 0, y: 0, w: 1, h: 1, z: 1, rows: [['a']], attendance: { pageId: 'src', blockId: 'cl' } } as unknown as Block] });
  const withAtt = { ...pages, att };
  it('are kept out of the library lists but found by the Journal button', () => {
    expect(listedPages(withAtt).map((p) => p.id)).not.toContain('att');
    expect(libraryPages(withAtt).map((p) => p.id)).toContain('att');
    expect(attendancePagesOf(withAtt).map((p) => p.id)).toEqual(['att']);
    expect(attendancePagesOf(pages)).toEqual([]);
  });
});
