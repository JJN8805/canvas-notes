import { describe, expect, it } from 'vitest';
import { cellName, colIndex, colName, deleteRefs, FUNCTION_NAMES, insertRefs, isErr, literalValue, parseCellName, shiftFormula } from '../src/lib/office/formula';
import { computeGrid } from '../src/lib/office/sheetModel';

/** The value of cell A1 (or the one asked for) of a small sheet. */
const run = (rows: string[][], at: [number, number] = [0, 0], now?: () => Date) => computeGrid(rows, now)[at[0]][at[1]];
const one = (formula: string, others: string[][] = []) => run([[formula], ...others]);

describe('cell names', () => {
  it('count letters like a spreadsheet does', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(colName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
    expect(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA'].map(colIndex)).toEqual([0, 25, 26, 51, 701, 702]);
    expect(cellName(0, 0)).toBe('A1');
    expect(cellName(9, 27)).toBe('AB10');
    expect(parseCellName('$C$12')).toEqual({ r: 11, c: 2 });
    expect(parseCellName('A0')).toBeNull();
    expect(parseCellName('hello')).toBeNull();
  });
});

describe('what a cell holds', () => {
  it('reads numbers, percentages and text; a leading apostrophe forces text', () => {
    expect(literalValue('')).toBeNull();
    expect(literalValue('42')).toBe(42);
    expect(literalValue(' -3.5 ')).toBe(-3.5);
    expect(literalValue('1e3')).toBe(1000);
    expect(literalValue('50%')).toBe(0.5);
    expect(literalValue('hello')).toBe('hello');
    expect(literalValue('12abc')).toBe('12abc');
    expect(literalValue("'123")).toBe('123');
  });
});

describe('arithmetic', () => {
  it('follows the usual order of operations', () => {
    expect(one('=1+2*3')).toBe(7);
    expect(one('=(1+2)*3')).toBe(9);
    expect(one('=2^3^2')).toBe(64); // left to right, as in Excel
    expect(one('=-2^2')).toBe(4); // a minus sign binds tighter than ^
    expect(one('=10/4')).toBe(2.5);
    expect(one('=50%')).toBe(0.5);
    expect(one('=200*10%')).toBe(20);
    expect(one('=1.5e2+1')).toBe(151);
    expect(one('=--3')).toBe(3);
  });
  it('compares and joins', () => {
    expect(one('=1<2')).toBe(true);
    expect(one('=2<=1')).toBe(false);
    expect(one('=1<>1')).toBe(false);
    expect(one('="a"="A"')).toBe(true); // text compares ignoring case
    expect(one('="abc"&"def"')).toBe('abcdef');
    expect(one('="n="&5')).toBe('n=5');
    expect(one('=1&2')).toBe('12');
  });
  it('turns text that reads as a number into one, and fails clearly on the rest', () => {
    expect(one('=A2+1', [['5']])).toBe(6);
    expect(one('="3"+1')).toBe(4);
    expect(one('="x"+1')).toEqual({ err: '#VALUE!' });
    expect(one('=A2+1', [['']])).toBe(1); // an empty cell is zero
  });
});

describe('errors', () => {
  it('say what went wrong and pass through what uses them', () => {
    expect(one('=1/0')).toEqual({ err: '#DIV/0!' });
    expect(one('=A2+1', [['=1/0']])).toEqual({ err: '#DIV/0!' });
    expect(one('=SUM(A2:A3)', [['=1/0'], ['1']])).toEqual({ err: '#DIV/0!' });
    expect(one('=NOPE(1)')).toEqual({ err: '#NAME?' });
    expect(one('=hello')).toEqual({ err: '#NAME?' });
    expect(one('=1+')).toEqual({ err: '#VALUE!' });
    expect(one('=(1+2')).toEqual({ err: '#VALUE!' });
    expect(one('="open')).toEqual({ err: '#VALUE!' });
    expect(one('=SQRT(-1)')).toEqual({ err: '#NUM!' });
    expect(one('=IFERROR(1/0,"none")')).toBe('none');
    expect(one('=IFERROR(7,"none")')).toBe(7);
  });
  it('catches a formula that depends on itself, however indirectly', () => {
    expect(run([['=A1']])).toEqual({ err: '#CIRC!' });
    expect(run([['=B1', '=A1']])).toEqual({ err: '#CIRC!' });
    expect(run([['=B1+1', '=C1+1', '=A1+1']], [0, 1])).toEqual({ err: '#CIRC!' });
    expect(isErr(run([['=SUM(A1:A2)'], ['1']]))).toBe(true); // a range that includes itself
  });
});

describe('functions on ranges', () => {
  const col = [['1'], ['2'], ['x'], [''], ['4']];
  it('add up, average and count only what is a number', () => {
    expect(one('=SUM(A2:A6)', col)).toBe(7);
    expect(one('=AVERAGE(A2:A6)', col)).toBeCloseTo(7 / 3);
    expect(one('=COUNT(A2:A6)', col)).toBe(3);
    expect(one('=COUNTA(A2:A6)', col)).toBe(4);
    expect(one('=COUNTBLANK(A2:A6)', col)).toBe(1);
    expect(one('=MIN(A2:A6)', col)).toBe(1);
    expect(one('=MAX(A2:A6)', col)).toBe(4);
    expect(one('=MEDIAN(A2:A6)', col)).toBe(2);
    expect(one('=PRODUCT(A2:A3)', col)).toBe(2);
  });
  it('take several arguments of any mix, and work on a two-dimensional range', () => {
    expect(one('=SUM(1,2,A2:A3)', [['10'], ['20']])).toBe(33);
    expect(run([['=SUM(B1:C2)', '1', '2'], ['', '3', '4']])).toBe(10);
    expect(one('=SUM()')).toBe(0);
  });
  it('divide by zero when there is nothing to average', () => {
    expect(one('=AVERAGE(A2:A3)', [[''], ['x']])).toEqual({ err: '#DIV/0!' });
  });
  it('accept the range written backwards or in lower case', () => {
    expect(one('=SUM(a3:a2)', [['1'], ['2']])).toBe(3);
  });
});

describe('functions', () => {
  it('do maths', () => {
    expect(one('=ABS(-4)')).toBe(4);
    expect(one('=SQRT(16)')).toBe(4);
    expect(one('=POWER(2,10)')).toBe(1024);
    expect(one('=MOD(10,3)')).toBe(1);
    expect(one('=MOD(-1,3)')).toBe(2);
    expect(one('=MOD(1,0)')).toEqual({ err: '#DIV/0!' });
    expect(one('=INT(-1.5)')).toBe(-2);
    expect(one('=ROUND(2.345,2)')).toBe(2.35);
    expect(one('=ROUND(-2.5,0)')).toBe(-3);
    expect(one('=ROUNDUP(2.01,1)')).toBe(2.1);
    expect(one('=ROUNDDOWN(2.99,1)')).toBe(2.9);
    expect(one('=PI()')).toBeCloseTo(Math.PI);
  });
  it('choose', () => {
    expect(one('=IF(1>2,"yes","no")')).toBe('no');
    expect(one('=IF(TRUE,1)')).toBe(1);
    expect(one('=IF(FALSE,1)')).toBe(false);
    expect(one('=IF(A2>5,"big","small")', [['9']])).toBe('big');
    expect(one('=AND(1,TRUE,2>1)')).toBe(true);
    expect(one('=AND(1,0)')).toBe(false);
    expect(one('=OR(0,0,1)')).toBe(true);
    expect(one('=NOT(TRUE)')).toBe(false);
  });
  it('only work out the branch they take', () => {
    expect(one('=IF(TRUE,1,1/0)')).toBe(1);
    expect(one('=IF(FALSE,1/0,2)')).toBe(2);
  });
  it('handle text', () => {
    expect(one('=LEN("hello")')).toBe(5);
    expect(one('=UPPER("abc")')).toBe('ABC');
    expect(one('=LOWER("ABC")')).toBe('abc');
    expect(one('=TRIM("  a   b ")')).toBe('a b');
    expect(one('=LEFT("hello",2)')).toBe('he');
    expect(one('=RIGHT("hello",3)')).toBe('llo');
    expect(one('=RIGHT("hello",0)')).toBe('');
    expect(one('=MID("hello",2,3)')).toBe('ell');
    expect(one('=CONCAT("a",1,TRUE)')).toBe('a1TRUE');
    expect(one('=CONCATENATE("a","b")')).toBe('ab');
    expect(one('=VALUE("12")')).toBe(12);
    expect(one('=VALUE("x")')).toEqual({ err: '#VALUE!' });
  });
  it('count dates as day numbers, and take the date from the clock only when asked', () => {
    expect(one('=DATE(2024,3,1)-DATE(2024,2,1)')).toBe(29);
    expect(one('=YEAR(DATE(2024,3,15))')).toBe(2024);
    expect(one('=MONTH(DATE(2024,3,15))')).toBe(3);
    expect(one('=DAY(DATE(2024,3,15))')).toBe(15);
    const fixed = () => new Date(2024, 2, 15, 12, 0, 0);
    expect(run([['=DAY(TODAY())']], [0, 0], fixed)).toBe(15);
    expect(run([['=NOW()-TODAY()']], [0, 0], fixed)).toBeCloseTo(0.5);
  });
  it('look things up and add up what matches', () => {
    const data = [['apple', '3'], ['pear', '5'], ['apple', '4'], ['plum', '']];
    expect(run([['=SUMIF(A2:A5,"apple",B2:B5)'], ...data])).toBe(7);
    expect(run([['=COUNTIF(A2:A5,"apple")'], ...data])).toBe(2);
    expect(run([['=COUNTIF(B2:B5,">3")'], ...data])).toBe(2);
    expect(run([['=COUNTIF(B2:B5,"<>3")'], ...data])).toBe(3);
    expect(run([['=SUMIF(B2:B5,">=4")'], ...data])).toBe(9);
    expect(run([['=AVERAGEIF(A2:A5,"apple",B2:B5)'], ...data])).toBe(3.5);
    expect(run([['=VLOOKUP("pear",A2:B5,2)'], ...data])).toBe(5);
    expect(run([['=VLOOKUP("kiwi",A2:B5,2)'], ...data])).toEqual({ err: '#N/A' });
    expect(run([['=VLOOKUP("pear",A2:B5,3)'], ...data])).toEqual({ err: '#REF!' });
  });
  it('are listed for the function menu', () => {
    for (const n of ['SUM', 'IF', 'VLOOKUP', 'COUNTIF', 'ROUND']) expect(FUNCTION_NAMES).toContain(n);
    expect(FUNCTION_NAMES).toEqual([...FUNCTION_NAMES].sort());
  });
});

describe('references', () => {
  it('follow other formulas, in any order', () => {
    expect(run([['=B1*2', '=C1+1', '4']])).toBe(10);
  });
  it('read outside the sheet as empty', () => {
    expect(one('=ZZ99+1')).toBe(1);
  });
  it('accept $ signs without changing the value', () => {
    expect(one('=$A$2+A$2+$A2', [['3']])).toBe(9);
  });
});

describe('copying a formula', () => {
  it('moves what is relative and keeps what is $absolute', () => {
    expect(shiftFormula('=A1+B2', 1, 1)).toBe('=B2+C3');
    expect(shiftFormula('=$A$1+B2', 2, 0)).toBe('=$A$1+B4');
    expect(shiftFormula('=$A1+B$2', 1, 1)).toBe('=$A2+C$2');
    expect(shiftFormula('=SUM(A1:A3)', 0, 1)).toBe('=SUM(B1:B3)');
    expect(shiftFormula('=A1&"A1"', 1, 0)).toBe('=A2&"A1"'); // text inside quotes is not a cell
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!'); // moved off the top
    expect(shiftFormula('=SUM(A1:A3)', -1, 0)).toBe('=SUM(#REF!)');
    expect(shiftFormula('hello A1', 1, 1)).toBe('hello A1');
    expect(shiftFormula('=LOG10(B1)', 1, 0)).toBe('=LOG10(B2)'); // LOG10 is a function, not a cell
  });
});

describe('inserting and deleting rows', () => {
  it('moves references at or past the new row', () => {
    expect(insertRefs('=A1+A3', 'row', 1, 2)).toBe('=A1+A5');
    expect(insertRefs('=SUM(A1:A3)', 'row', 1, 1)).toBe('=SUM(A1:A4)'); // the range grows
    expect(insertRefs('=SUM(A1:A3)', 'row', 3, 1)).toBe('=SUM(A1:A3)'); // inserted just after it: no growth
    expect(insertRefs('=A1+C1', 'col', 1, 1)).toBe('=A1+D1');
  });
  it('turns references to deleted rows into #REF! and closes the gap for the rest', () => {
    expect(deleteRefs('=A1+A3', 'row', 1, 1)).toBe('=A1+A2');
    expect(deleteRefs('=A2', 'row', 1, 1)).toBe('=#REF!');
    expect(deleteRefs('=SUM(A1:A4)', 'row', 1, 2)).toBe('=SUM(A1:A2)'); // the range loses the deleted part
    expect(deleteRefs('=SUM(A2:A3)', 'row', 1, 2)).toBe('=SUM(#REF!)'); // all of it gone
    expect(deleteRefs('=SUM(A1:A3)', 'row', 0, 1)).toBe('=SUM(A1:A2)');
    expect(deleteRefs('=B1', 'col', 0, 1)).toBe('=A1');
  });
});
