import { describe, expect, it } from 'vitest';
import { clearCells, computeGrid, copyCells, deleteLines, displayRows, ensureSize, fillRange, formatCells, formatValue, insertLines, MAX_COLS, MAX_ROWS, normRect, parseCsv, pasteCells, rangeStats, sortRows, toCsv, usedRange, alignOf, type GridState } from '../src/lib/office/sheetModel';

const grid = (rows: string[][], fmt: GridState['fmt'] = {}, colW: GridState['colW'] = {}): GridState => ({ rows, fmt, colW });
const R = (r1: number, c1: number, r2: number, c2: number) => ({ r1, c1, r2, c2 });

describe('showing values', () => {
  it('writes numbers without needless digits', () => {
    expect(formatValue(0.1 + 0.2)).toBe('0.3');
    expect(formatValue(1 / 3)).toBe('0.333333333333');
    expect(formatValue(1234567)).toBe('1234567');
    expect(formatValue(null)).toBe('');
    expect(formatValue(true)).toBe('TRUE');
    expect(formatValue({ err: '#DIV/0!' })).toBe('#DIV/0!');
    expect(formatValue('text', { nf: 'cur' })).toBe('text');
  });
  it('applies number formats', () => {
    expect(formatValue(1234.5, { nf: 'num' })).toBe('1,234.50');
    expect(formatValue(1234.567, { nf: 'num', dec: 1 })).toBe('1,234.6');
    expect(formatValue(1234.5, { nf: 'int' })).toBe('1,235');
    expect(formatValue(-1234.5, { nf: 'cur' })).toBe('-$1,234.50');
    expect(formatValue(1234.5, { nf: 'cur', dec: 0 })).toBe('$1,235');
    expect(formatValue(0.256, { nf: 'pct' })).toBe('26%');
    expect(formatValue(0.256, { nf: 'pct', dec: 1 })).toBe('25.6%');
    expect(formatValue(45366, { nf: 'date' })).toBe('2024-03-15');
    expect(formatValue(-0.001, { nf: 'num' })).toBe('0.00'); // no "-0.00"
  });
  it('aligns numbers right, text left, and a chosen alignment always wins', () => {
    expect(alignOf(5)).toBe('r');
    expect(alignOf('a')).toBe('l');
    expect(alignOf(true)).toBe('c');
    expect(alignOf({ err: '#N/A' })).toBe('c');
    expect(alignOf(5, { al: 'l' })).toBe('l');
  });
  it('shows the part of a sheet that has something in it, worked out and formatted', () => {
    const rows = ensureSize([['Item', 'Cost'], ['Tea', '2.5'], ['Total', '=SUM(B2:B2)*2']], 100, 26);
    expect(usedRange(rows)).toEqual({ rows: 3, cols: 2 });
    expect(displayRows(rows, { B3: { nf: 'cur' } })).toEqual([['Item', 'Cost'], ['Tea', '2.5'], ['Total', '$5.00']]);
    expect(displayRows(ensureSize([['']], 5, 5))).toEqual([['']]);
  });
});

describe('growing', () => {
  it('adds empty rows and columns up to a limit', () => {
    const g = ensureSize([['a']], 3, 2);
    expect(g).toEqual([['a', ''], ['', ''], ['', '']]);
    expect(ensureSize([['a']], 99999, 99999).length).toBe(MAX_ROWS);
    expect(ensureSize([['a']], 2, 99999)[0].length).toBe(MAX_COLS);
  });
});

describe('selections', () => {
  it('are the same whichever way they are dragged', () => {
    expect(normRect({ r: 5, c: 1 }, { r: 2, c: 4 })).toEqual(R(2, 1, 5, 4));
  });
  it('are summed up', () => {
    const v = computeGrid([['1', '2', 'x'], ['3', '', '4']]);
    const s = rangeStats(v, R(0, 0, 1, 2));
    expect(s).toMatchObject({ sum: 10, numbers: 4, count: 5, min: 1, max: 4 });
    expect(s.avg).toBe(2.5);
    expect(rangeStats(v, R(0, 2, 0, 2)).avg).toBeNull();
  });
});

describe('inserting rows and columns', () => {
  const g = grid([['1', '=A1*2'], ['2', '=A2*2'], ['=SUM(A1:A2)', '']], { B1: { b: 1 }, A3: { nf: 'cur' } });
  it('adds a row, moves the formats and keeps formulas pointing at the same cells', () => {
    const out = insertLines(g, 'row', 1);
    expect(out.rows).toEqual([['1', '=A1*2'], ['', ''], ['2', '=A3*2'], ['=SUM(A1:A3)', '']]);
    expect(out.fmt).toEqual({ B1: { b: 1 }, A4: { nf: 'cur' } });
    expect(computeGrid(out.rows)[2]).toEqual([2, 4]);
  });
  it('adds a column, and moves column widths with it', () => {
    const out = insertLines(grid([['1', '=A1+B1']], {}, { '0': 100, '1': 200 }), 'col', 1);
    expect(out.rows[0]).toEqual(['1', '', '=A1+C1']);
    expect(out.colW).toEqual({ '0': 100, '2': 200 });
  });
  it('stops at the size limit', () => {
    const full = ensureSize([['x']], MAX_ROWS, 1);
    expect(insertLines(grid(full), 'row', 0).rows.length).toBe(MAX_ROWS);
  });
});

describe('deleting rows and columns', () => {
  const g = grid([['1', '=A1*2'], ['2', '=A2*2'], ['=SUM(A1:A2)', '=A2']], { B2: { b: 1 }, A3: { i: 1 } });
  it('drops the row, with its formats, and #REF!s what pointed at it', () => {
    const out = deleteLines(g, 'row', 1);
    expect(out.rows).toEqual([['1', '=A1*2'], ['=SUM(A1:A1)', '=#REF!']]);
    expect(out.fmt).toEqual({ A2: { i: 1 } });
    expect(computeGrid(out.rows)[1][1]).toEqual({ err: '#REF!' });
  });
  it('drops a column', () => {
    const out = deleteLines(grid([['1', '2', '=B1']], {}, { '1': 50, '2': 70 }), 'col', 0);
    expect(out.rows).toEqual([['2', '=A1']]);
    expect(out.colW).toEqual({ '0': 50, '1': 70 });
  });
  it('always leaves one row and one column', () => {
    expect(deleteLines(grid([['a']]), 'row', 0).rows).toEqual([['a']]);
    expect(deleteLines(grid([['a', 'b']]), 'col', 0, 5).rows).toEqual([['b']]);
  });
});

describe('sorting', () => {
  it('orders rows by a column, numbers before text, empties last in both directions', () => {
    const g = grid([['b', '3'], ['a', ''], ['c', '1'], ['d', '2']]);
    expect(sortRows(g, R(0, 0, 3, 1), 1, 'asc').rows.map((r) => r[0])).toEqual(['c', 'd', 'b', 'a']);
    expect(sortRows(g, R(0, 0, 3, 1), 1, 'desc').rows.map((r) => r[0])).toEqual(['b', 'd', 'c', 'a']);
    expect(sortRows(g, R(0, 0, 3, 1), 0, 'asc').rows.map((r) => r[0])).toEqual(['a', 'b', 'c', 'd']);
  });
  it('leaves rows outside the selection (a header) alone and sorts equal ones stably', () => {
    const g = grid([['Name', 'N'], ['x', '2'], ['y', '1'], ['z', '1']]);
    expect(sortRows(g, R(1, 0, 3, 1), 1, 'asc').rows).toEqual([['Name', 'N'], ['y', '1'], ['z', '1'], ['x', '2']]);
  });
  it('keeps a formula that points along its own row working, and moves formats with the row', () => {
    const g = grid([['3', '=A1*10'], ['1', '=A2*10']], { A1: { b: 1 } });
    const out = sortRows(g, R(0, 0, 1, 1), 0, 'asc');
    expect(out.rows).toEqual([['1', '=A1*10'], ['3', '=A2*10']]);
    expect(out.fmt).toEqual({ A2: { b: 1 } });
    expect(computeGrid(out.rows).map((r) => r[1])).toEqual([10, 30]);
  });
  it('sorts by the value a formula gives, not its text', () => {
    const g = grid([['=2+8'], ['=1+1'], ['5']]);
    expect(sortRows(g, R(0, 0, 2, 0), 0, 'asc').rows.map((r) => r[0])).toEqual(['=1+1', '5', '=2+8']);
  });
});

describe('fill handle', () => {
  it('copies a formula down, moving what is relative', () => {
    const g = grid([['1', '=A1*2'], ['2', ''], ['3', '']]);
    const out = fillRange(g, R(0, 1, 0, 1), { r: 2, c: 1 });
    expect(out.rows.map((r) => r[1])).toEqual(['=A1*2', '=A2*2', '=A3*2']);
  });
  it('carries a series on', () => {
    expect(fillRange(grid([['1'], ['2'], [''], [''], ['']]), R(0, 0, 1, 0), { r: 4, c: 0 }).rows.map((r) => r[0])).toEqual(['1', '2', '3', '4', '5']);
    expect(fillRange(grid([['10'], ['7'], [''], ['']]), R(0, 0, 1, 0), { r: 3, c: 0 }).rows.map((r) => r[0])).toEqual(['10', '7', '4', '1']);
  });
  it('repeats a lone number or text, and cycles several', () => {
    expect(fillRange(grid([['5'], [''], ['']]), R(0, 0, 0, 0), { r: 2, c: 0 }).rows.map((r) => r[0])).toEqual(['5', '5', '5']);
    expect(fillRange(grid([['a'], ['b'], [''], [''], ['']]), R(0, 0, 1, 0), { r: 4, c: 0 }).rows.map((r) => r[0])).toEqual(['a', 'b', 'a', 'b', 'a']);
  });
  it('fills to the right, and upwards', () => {
    expect(fillRange(grid([['1', '2', '', '']]), R(0, 0, 0, 1), { r: 0, c: 3 }).rows[0]).toEqual(['1', '2', '3', '4']);
    expect(fillRange(grid([[''], [''], ['1'], ['2']]), R(2, 0, 3, 0), { r: 0, c: 0 }).rows.map((r) => r[0])).toEqual(['-1', '0', '1', '2']);
  });
  it('carries formats along, and grows the sheet when asked to go past its end', () => {
    const g = grid([['1']], { A1: { b: 1 } });
    const out = fillRange(g, R(0, 0, 0, 0), { r: 3, c: 0 });
    expect(out.rows.length).toBe(4);
    expect(out.fmt.A4).toEqual({ b: 1 });
  });
  it('does nothing when dragged inside the selection', () => {
    const g = grid([['1', '2']]);
    expect(fillRange(g, R(0, 0, 0, 1), { r: 0, c: 1 })).toBe(g);
  });
});

describe('copy and paste', () => {
  it('moves formulas by the distance pasted, and brings the formats', () => {
    const g = grid([['1', '=A1+1'], ['', '']], { B1: { b: 1 } });
    const clip = copyCells(g, R(0, 0, 0, 1));
    const out = pasteCells(g, { r: 1, c: 0 }, clip);
    expect(out.rows[1]).toEqual(['1', '=A2+1']);
    expect(out.fmt.B2).toEqual({ b: 1 });
  });
  it('grows the sheet to fit and replaces what was there', () => {
    const g = grid([['x']], { A1: { i: 1 } });
    const out = pasteCells(g, { r: 0, c: 0 }, { cells: [['a', 'b'], ['c', 'd']], fmts: [[undefined, undefined], [undefined, undefined]], origin: { r: 0, c: 0 } });
    expect(out.rows).toEqual([['a', 'b'], ['c', 'd']]);
    expect(out.fmt).toEqual({});
  });
  it('clears typed content but keeps formats', () => {
    const out = clearCells(grid([['a', 'b'], ['c', 'd']], { A1: { b: 1 } }), R(0, 0, 0, 1));
    expect(out.rows).toEqual([['', ''], ['c', 'd']]);
    expect(out.fmt).toEqual({ A1: { b: 1 } });
  });
});

describe('formatting a selection', () => {
  it('sets, merges and removes formats', () => {
    let g = formatCells(grid([['a', 'b']]), R(0, 0, 0, 1), { b: 1 });
    g = formatCells(g, R(0, 0, 0, 0), { nf: 'pct', dec: 1 });
    expect(g.fmt).toEqual({ A1: { b: 1, nf: 'pct', dec: 1 }, B1: { b: 1 } });
    g = formatCells(g, R(0, 0, 0, 1), { b: undefined });
    expect(g.fmt).toEqual({ A1: { nf: 'pct', dec: 1 } });
    g = formatCells(g, R(0, 0, 0, 0), { nf: undefined, dec: undefined });
    expect(g.fmt).toEqual({});
  });
});

describe('CSV', () => {
  it('reads quoted cells, quotes, line breaks, other separators and a byte-order mark', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('"a,b","say ""hi"""\r\n"line\nbreak",x')).toEqual([['a,b', 'say "hi"'], ['line\nbreak', 'x']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('﻿a,b')).toEqual([['a', 'b']]);
    expect(parseCsv('a,b\n1')).toEqual([['a', 'b'], ['1', '']]); // ragged rows are padded
    expect(parseCsv('')).toEqual([['']]);
  });
  it('writes quotes only where needed, and reads back what it wrote', () => {
    const rows = [['plain', 'a,b', 'say "hi"'], ['line\nbreak', '', '5']];
    const text = toCsv(rows);
    expect(text.split('\r\n')[0]).toBe('plain,"a,b","say ""hi"""');
    expect(parseCsv(text)).toEqual(rows);
  });
});
