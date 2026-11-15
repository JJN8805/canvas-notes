import { describe, expect, it } from 'vitest';
import { afterCommit, fromTsv, move, rectOf, single, toTsv, visibleRows } from '../src/lib/office/sheetNav';

const bounds = { rows: 10, cols: 5 };

describe('moving around the grid', () => {
  it('moves one cell and stops at the edges', () => {
    expect(move(single({ r: 0, c: 0 }), 'down', { bounds }).focus).toEqual({ r: 1, c: 0 });
    expect(move(single({ r: 0, c: 0 }), 'up', { bounds }).focus).toEqual({ r: 0, c: 0 });
    expect(move(single({ r: 9, c: 4 }), 'right', { bounds }).focus).toEqual({ r: 9, c: 4 });
  });
  it('Shift grows the selection from where it started', () => {
    let s = single({ r: 2, c: 2 });
    s = move(s, 'down', { bounds, extend: true });
    s = move(s, 'right', { bounds, extend: true });
    expect(rectOf(s)).toEqual({ r1: 2, c1: 2, r2: 3, c2: 3 });
    s = move(s, 'up', { bounds, extend: true });
    s = move(s, 'up', { bounds, extend: true });
    expect(rectOf(s)).toEqual({ r1: 1, c1: 2, r2: 2, c2: 3 });
    expect(s.anchor).toEqual({ r: 2, c: 2 });
  });
  it('Ctrl+arrow jumps along a run of filled cells, then to the next one, then to the edge', () => {
    const filled = new Set(['1,0', '2,0', '3,0', '6,0']);
    const has = (p: { r: number; c: number }) => filled.has(`${p.r},${p.c}`);
    const go = (r: number) => move(single({ r, c: 0 }), 'down', { bounds, edge: true, filled: has }).focus.r;
    expect(go(1)).toBe(3); // end of the run
    expect(go(3)).toBe(6); // next filled cell
    expect(go(6)).toBe(9); // nothing further: the edge
    expect(go(0)).toBe(1); // from an empty cell: the first filled one
  });
  it('after typing, Enter goes down, Tab goes right, with Shift the other way, inside the sheet', () => {
    const s = single({ r: 0, c: 0 });
    expect(afterCommit(s, 'enter', bounds).focus).toEqual({ r: 1, c: 0 });
    expect(afterCommit(s, 'shift-enter', bounds).focus).toEqual({ r: 0, c: 0 });
    expect(afterCommit(s, 'tab', bounds).focus).toEqual({ r: 0, c: 1 });
    expect(afterCommit(single({ r: 0, c: 4 }), 'tab', bounds).focus).toEqual({ r: 0, c: 4 });
  });
});

describe('drawing only the rows in view', () => {
  it('covers the view plus a margin, within the sheet', () => {
    expect(visibleRows(0, 240, 24, 1000, 5)).toEqual({ from: 0, to: 15 });
    expect(visibleRows(2400, 240, 24, 1000, 5)).toEqual({ from: 95, to: 115 });
    expect(visibleRows(100000, 240, 24, 50, 5)).toEqual({ from: 50, to: 50 });
  });
});

describe('clipboard text', () => {
  it('writes tabs and line breaks, quoting what needs it, and reads it back', () => {
    const cells = [['a', 'b\tc'], ['line1\nline2', 'say "hi"']];
    expect(fromTsv(toTsv(cells))).toEqual(cells);
    expect(toTsv([['1', '2'], ['3', '4']])).toBe('1\t2\n3\t4');
  });
  it('reads values pasted from other programs', () => {
    expect(fromTsv('x')).toEqual([['x']]);
    expect(fromTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(fromTsv('')).toEqual([['']]);
  });
});
