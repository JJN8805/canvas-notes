/**
 * The spreadsheet's formula language (pure code: no app state, so it is tested without the app).
 *
 * A cell holds text. Text starting with "=" is a formula: numbers, "strings", cell names (A1, $B$2), ranges (A1:C3), the operators
 * + - * / ^ & % = <> < > <= >= and functions (SUM, IF, VLOOKUP…). Anything else is a value: a number if it reads as one, otherwise text.
 * Errors are values too (#DIV/0!, #REF!, #NAME?, #VALUE!, #CIRC!), and travel through whatever uses them, as in Excel.
 */

export type ErrorCode = '#DIV/0!' | '#REF!' | '#NAME?' | '#VALUE!' | '#CIRC!' | '#N/A' | '#NUM!';
export interface CellError {
  err: ErrorCode;
}
/** What a cell is worth. `null` is an empty cell. */
export type Val = number | string | boolean | CellError | null;
export type Range = { range: Val[][] };

export const err = (e: ErrorCode): CellError => ({ err: e });
export const isErr = (v: unknown): v is CellError => typeof v === 'object' && v !== null && 'err' in v;
const isRange = (v: unknown): v is Range => typeof v === 'object' && v !== null && 'range' in v;

/* ------------------------------------------------------------------ */
/* Cell names                                                          */
/* ------------------------------------------------------------------ */

/** 0 → A, 25 → Z, 26 → AA. */
export function colName(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** A → 0, AA → 26. */
export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** (row 0, column 0) → "A1". */
export const cellName = (r: number, c: number) => `${colName(c)}${r + 1}`;

/** "B3" or "$B$3" → its row and column (zero-based), or null. */
export function parseCellName(s: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(s.trim());
  if (!m) return null;
  const r = Number(m[2]) - 1;
  return r < 0 ? null : { r, c: colIndex(m[1]) };
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

type TokType = 'num' | 'str' | 'ref' | 'name' | 'op' | 'lp' | 'rp' | 'comma' | 'errlit';
interface Tok {
  t: TokType;
  s: string;
  /** Where it sits in the formula text. */
  i: number;
  j: number;
  /** For refs. */
  ref?: RefParts;
}
export interface RefParts {
  r: number;
  c: number;
  absR: boolean;
  absC: boolean;
}

class Bad extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

const REF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)/;
const NUM = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.]*/;
const OPS = ['<=', '>=', '<>', '+', '-', '*', '/', '^', '&', '=', '<', '>', ':', '%'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= src.length) throw new Bad('#VALUE!'); // an unclosed string
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      out.push({ t: 'str', s, i, j: j + 1 });
      i = j + 1;
      continue;
    }
    if (ch === '(') out.push({ t: 'lp', s: ch, i, j: i + 1 });
    else if (ch === ')') out.push({ t: 'rp', s: ch, i, j: i + 1 });
    else if (ch === ',' || ch === ';') out.push({ t: 'comma', s: ',', i, j: i + 1 });
    if (ch === '(' || ch === ')' || ch === ',' || ch === ';') {
      i++;
      continue;
    }
    const lit = /^#(REF!|DIV\/0!|NAME\?|VALUE!|N\/A|NUM!|CIRC!)/.exec(rest);
    if (lit) {
      out.push({ t: 'errlit', s: lit[0], i, j: i + lit[0].length });
      i += lit[0].length;
      continue;
    }
    const num = NUM.exec(rest);
    if (num && /[\d.]/.test(ch)) {
      out.push({ t: 'num', s: num[0], i, j: i + num[0].length });
      i += num[0].length;
      continue;
    }
    const ref = REF.exec(rest);
    if (ref) {
      const after = rest[ref[0].length] ?? '';
      if (!/[A-Za-z0-9_(.]/.test(after)) {
        out.push({ t: 'ref', s: ref[0], i, j: i + ref[0].length, ref: { r: Number(ref[4]) - 1, c: colIndex(ref[2]), absR: ref[3] === '$', absC: ref[1] === '$' } });
        i += ref[0].length;
        continue;
      }
    }
    const name = NAME.exec(rest);
    if (name) {
      out.push({ t: 'name', s: name[0], i, j: i + name[0].length });
      i += name[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      out.push({ t: 'op', s: op, i, j: i + op.length });
      i += op.length;
      continue;
    }
    throw new Bad('#NAME?');
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'err'; code: ErrorCode }
  | { k: 'ref'; r: number; c: number }
  | { k: 'range'; r1: number; c1: number; r2: number; c2: number }
  | { k: 'un'; op: '-' | '+'; a: Node }
  | { k: 'pct'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] };

function parseTokens(toks: Tok[]): Node {
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...ops: string[]) => peek()?.t === 'op' && ops.includes(peek().s);
  const take = () => toks[p++];

  const primary = (): Node => {
    const t = take();
    if (!t) throw new Bad('#VALUE!');
    if (t.t === 'num') return { k: 'num', v: Number(t.s) };
    if (t.t === 'str') return { k: 'str', v: t.s };
    if (t.t === 'errlit') return { k: 'err', code: t.s as ErrorCode };
    if (t.t === 'lp') {
      const e = cmp();
      if (take()?.t !== 'rp') throw new Bad('#VALUE!');
      return e;
    }
    if (t.t === 'ref') {
      if (isOp(':') && toks[p + 1]?.t === 'ref') {
        take();
        const b = take();
        const a = t.ref!;
        const z = b.ref!;
        return { k: 'range', r1: Math.min(a.r, z.r), c1: Math.min(a.c, z.c), r2: Math.max(a.r, z.r), c2: Math.max(a.c, z.c) };
      }
      return { k: 'ref', r: t.ref!.r, c: t.ref!.c };
    }
    if (t.t === 'name') {
      const up = t.s.toUpperCase();
      if (peek()?.t === 'lp') {
        take();
        const args: Node[] = [];
        if (peek()?.t === 'rp') take();
        else {
          for (;;) {
            args.push(cmp());
            const n = take();
            if (n?.t === 'rp') break;
            if (n?.t !== 'comma') throw new Bad('#VALUE!');
          }
        }
        return { k: 'call', name: up, args };
      }
      if (up === 'TRUE') return { k: 'bool', v: true };
      if (up === 'FALSE') return { k: 'bool', v: false };
      throw new Bad('#NAME?');
    }
    throw new Bad('#VALUE!');
  };
  const post = (): Node => {
    let n = primary();
    while (isOp('%')) {
      take();
      n = { k: 'pct', a: n };
    }
    return n;
  };
  const unary = (): Node => {
    if (isOp('-', '+')) {
      const op = take().s as '-' | '+';
      return { k: 'un', op, a: unary() };
    }
    return post();
  };
  const pow = (): Node => {
    let n = unary();
    while (isOp('^')) {
      take();
      n = { k: 'bin', op: '^', a: n, b: unary() };
    }
    return n;
  };
  const mul = (): Node => {
    let n = pow();
    while (isOp('*', '/')) {
      const op = take().s;
      n = { k: 'bin', op, a: n, b: pow() };
    }
    return n;
  };
  const add = (): Node => {
    let n = mul();
    while (isOp('+', '-')) {
      const op = take().s;
      n = { k: 'bin', op, a: n, b: mul() };
    }
    return n;
  };
  const concat = (): Node => {
    let n = add();
    while (isOp('&')) {
      take();
      n = { k: 'bin', op: '&', a: n, b: add() };
    }
    return n;
  };
  const cmp = (): Node => {
    let n = concat();
    while (isOp('=', '<>', '<', '>', '<=', '>=')) {
      const op = take().s;
      n = { k: 'bin', op, a: n, b: concat() };
    }
    return n;
  };
  const tree = cmp();
  if (p < toks.length) throw new Bad('#VALUE!');
  return tree;
}

const astCache = new Map<string, Node | CellError>();

/** The parsed form of a formula (text starting with "="), or the error it is. Parsed once per distinct text. */
export function parseFormula(src: string): Node | CellError {
  const hit = astCache.get(src);
  if (hit) return hit;
  let out: Node | CellError;
  try {
    out = parseTokens(tokenize(src.slice(1)));
  } catch (e) {
    out = e instanceof Bad ? err(e.code) : err('#VALUE!');
  }
  if (astCache.size > 3000) astCache.clear();
  astCache.set(src, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

const NUMBER_TEXT = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;
const PERCENT_TEXT = /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*%\s*$/;

/** What typing `raw` into a cell means when it is not a formula. */
export function literalValue(raw: string): Val {
  if (raw === '') return null;
  if (raw.startsWith("'")) return raw.slice(1); // a leading ' keeps what follows as text
  if (NUMBER_TEXT.test(raw)) return Number(raw);
  if (PERCENT_TEXT.test(raw)) return Number(raw.replace('%', '')) / 100;
  return raw;
}

export const isFormula = (raw: string) => raw.length > 1 && raw[0] === '=';

/** A number as plain text, the way "General" shows it (no needless digits). */
export function numberText(n: number): string {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? '#NUM!' : '#NUM!';
  const s = Number(n.toPrecision(12)).toString();
  return s;
}

const toNumber = (v: Val | Range): number | CellError => {
  if (isRange(v)) {
    if (v.range.length === 1 && v.range[0].length === 1) return toNumber(v.range[0][0]);
    return err('#VALUE!');
  }
  if (isErr(v)) return v;
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (NUMBER_TEXT.test(v)) return Number(v);
  if (PERCENT_TEXT.test(v)) return Number(v.replace('%', '')) / 100;
  return err('#VALUE!');
};

const toText = (v: Val | Range): string | CellError => {
  if (isRange(v)) return v.range.length === 1 && v.range[0].length === 1 ? toText(v.range[0][0]) : err('#VALUE!');
  if (isErr(v)) return v;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return numberText(v);
  return v;
};

const toBool = (v: Val | Range): boolean | CellError => {
  if (isRange(v)) return v.range.length === 1 && v.range[0].length === 1 ? toBool(v.range[0][0]) : err('#VALUE!');
  if (isErr(v)) return v;
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  return err('#VALUE!');
};

const scalar = (v: Val | Range): Val => (isRange(v) ? (v.range.length === 1 && v.range[0].length === 1 ? v.range[0][0] : err('#VALUE!')) : v);

/** Excel's order for mixed kinds: numbers, then text, then logical values. */
function compare(a: Val, b: Val): number {
  const rank = (v: Val) => (typeof v === 'number' || v === null ? 0 : typeof v === 'string' ? 1 : 2);
  if (a === null && typeof b === 'string') a = '';
  if (b === null && typeof a === 'string') b = '';
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = typeof a === 'boolean' ? Number(a) : (a ?? 0);
  const y = typeof b === 'boolean' ? Number(b) : (b ?? 0);
  return (x as number) - (y as number);
}

/** A date as a serial number (days since 1899-12-30), as spreadsheets count them. */
export const dateSerial = (d: Date) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
export const serialToDate = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);

/* ------------------------------------------------------------------ */
/* Evaluating                                                          */
/* ------------------------------------------------------------------ */

export interface EvalCtx {
  /** The value of a cell; anything outside the grid is empty. */
  cell(r: number, c: number): Val;
  /** "Now", injectable so tests do not depend on the clock. */
  now?: () => Date;
}

function flatten(args: (Val | Range)[]): { vals: Val[]; direct: Val[] } {
  const vals: Val[] = [];
  const direct: Val[] = [];
  for (const a of args) {
    if (isRange(a)) for (const row of a.range) vals.push(...row);
    else {
      vals.push(a);
      direct.push(a);
    }
  }
  return { vals, direct };
}

/** The numbers among the arguments: from ranges only real numbers, from direct arguments anything that reads as one. */
function numbers(args: (Val | Range)[]): number[] | CellError {
  const out: number[] = [];
  for (const a of args) {
    if (isRange(a)) {
      for (const row of a.range)
        for (const v of row) {
          if (isErr(v)) return v;
          if (typeof v === 'number') out.push(v);
        }
    } else {
      if (a === null) continue;
      const n = toNumber(a);
      if (isErr(n)) return n;
      out.push(n);
    }
  }
  return out;
}

/** True when `v` meets a COUNTIF-style condition such as ">5", "<>x", "=3" or plain "apple". */
function meets(v: Val, criterion: Val): boolean {
  if (typeof criterion === 'string') {
    const m = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(criterion)!;
    const op = m[1] ?? '=';
    const want = literalValue(m[2]);
    if (op === '=' && want === null) return v === null || v === '';
    const c = compare(v, want);
    const sameKind = typeof v === typeof want || (v === null && want === null);
    if (op === '=') return sameKind && c === 0;
    if (op === '<>') return !sameKind || c !== 0;
    if (!sameKind) return false;
    return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
  }
  return typeof v === typeof criterion && compare(v, criterion) === 0;
}

const round = (n: number, d: number, mode: 'near' | 'up' | 'down') => {
  const f = 10 ** d;
  const x = n * f;
  const r = mode === 'near' ? Math.sign(x) * Math.round(Math.abs(x)) : mode === 'up' ? Math.sign(x) * Math.ceil(Math.abs(x)) : Math.sign(x) * Math.floor(Math.abs(x));
  return r / f;
};

type Fn = (args: Node[], ev: (n: Node) => Val | Range, ctx: EvalCtx) => Val;

const needNums = (args: Node[], ev: (n: Node) => Val | Range, count: number): number[] | CellError => {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const n = args[i] ? toNumber(ev(args[i])) : 0;
    if (isErr(n)) return n;
    out.push(n);
  }
  return out;
};

const FUNCTIONS: Record<string, Fn> = {
  SUM: (a, ev) => {
    const n = numbers(a.map(ev));
    return isErr(n) ? n : n.reduce((s, x) => s + x, 0);
  },
  PRODUCT: (a, ev) => {
    const n = numbers(a.map(ev));
    return isErr(n) ? n : n.length ? n.reduce((s, x) => s * x, 1) : 0;
  },
  AVERAGE: (a, ev) => {
    const n = numbers(a.map(ev));
    if (isErr(n)) return n;
    return n.length ? n.reduce((s, x) => s + x, 0) / n.length : err('#DIV/0!');
  },
  MIN: (a, ev) => {
    const n = numbers(a.map(ev));
    return isErr(n) ? n : n.length ? Math.min(...n) : 0;
  },
  MAX: (a, ev) => {
    const n = numbers(a.map(ev));
    return isErr(n) ? n : n.length ? Math.max(...n) : 0;
  },
  MEDIAN: (a, ev) => {
    const n = numbers(a.map(ev));
    if (isErr(n)) return n;
    if (!n.length) return err('#NUM!');
    const s = [...n].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },
  COUNT: (a, ev) => {
    const { vals, direct } = flatten(a.map(ev));
    const inRange = vals.filter((v) => typeof v === 'number').length;
    // a direct argument counts when it reads as a number (so COUNT("3") is 1), but a number in a range only when it is one
    const extra = direct.filter((v) => typeof v === 'string' && NUMBER_TEXT.test(v)).length;
    return inRange + extra;
  },
  COUNTA: (a, ev) => flatten(a.map(ev)).vals.filter((v) => v !== null && v !== '').length,
  COUNTBLANK: (a, ev) => flatten(a.map(ev)).vals.filter((v) => v === null || v === '').length,
  ABS: (a, ev) => {
    const n = needNums(a, ev, 1);
    return isErr(n) ? n : Math.abs(n[0]);
  },
  SQRT: (a, ev) => {
    const n = needNums(a, ev, 1);
    if (isErr(n)) return n;
    return n[0] < 0 ? err('#NUM!') : Math.sqrt(n[0]);
  },
  POWER: (a, ev) => {
    const n = needNums(a, ev, 2);
    if (isErr(n)) return n;
    const r = n[0] ** n[1];
    return Number.isFinite(r) ? r : err('#NUM!');
  },
  MOD: (a, ev) => {
    const n = needNums(a, ev, 2);
    if (isErr(n)) return n;
    return n[1] === 0 ? err('#DIV/0!') : n[0] - n[1] * Math.floor(n[0] / n[1]);
  },
  INT: (a, ev) => {
    const n = needNums(a, ev, 1);
    return isErr(n) ? n : Math.floor(n[0]);
  },
  ROUND: (a, ev) => {
    const n = needNums(a, ev, 2);
    return isErr(n) ? n : round(n[0], n[1], 'near');
  },
  ROUNDUP: (a, ev) => {
    const n = needNums(a, ev, 2);
    return isErr(n) ? n : round(n[0], n[1], 'up');
  },
  ROUNDDOWN: (a, ev) => {
    const n = needNums(a, ev, 2);
    return isErr(n) ? n : round(n[0], n[1], 'down');
  },
  PI: () => Math.PI,
  IF: (a, ev) => {
    if (a.length < 2) return err('#VALUE!');
    const c = toBool(ev(a[0]));
    if (isErr(c)) return c;
    if (c) return scalar(ev(a[1]));
    return a[2] ? scalar(ev(a[2])) : false;
  },
  IFERROR: (a, ev) => {
    if (a.length < 2) return err('#VALUE!');
    const v = scalar(ev(a[0]));
    return isErr(v) ? scalar(ev(a[1])) : v;
  },
  AND: (a, ev) => {
    for (const v of flatten(a.map(ev)).vals) {
      if (v === null) continue;
      const b = toBool(v);
      if (isErr(b)) return b;
      if (!b) return false;
    }
    return true;
  },
  OR: (a, ev) => {
    let any = false;
    for (const v of flatten(a.map(ev)).vals) {
      if (v === null) continue;
      const b = toBool(v);
      if (isErr(b)) return b;
      if (b) any = true;
    }
    return any;
  },
  NOT: (a, ev) => {
    const b = toBool(ev(a[0]));
    return isErr(b) ? b : !b;
  },
  TRUE: () => true,
  FALSE: () => false,
  CONCAT: (a, ev) => {
    let s = '';
    for (const v of flatten(a.map(ev)).vals) {
      const t = toText(v);
      if (isErr(t)) return t;
      s += t;
    }
    return s;
  },
  LEN: (a, ev) => {
    const t = toText(ev(a[0]));
    return isErr(t) ? t : t.length;
  },
  UPPER: (a, ev) => {
    const t = toText(ev(a[0]));
    return isErr(t) ? t : t.toUpperCase();
  },
  LOWER: (a, ev) => {
    const t = toText(ev(a[0]));
    return isErr(t) ? t : t.toLowerCase();
  },
  TRIM: (a, ev) => {
    const t = toText(ev(a[0]));
    return isErr(t) ? t : t.trim().replace(/\s+/g, ' ');
  },
  LEFT: (a, ev) => {
    const t = toText(ev(a[0]));
    const n = a[1] ? toNumber(ev(a[1])) : 1;
    if (isErr(t)) return t;
    if (isErr(n)) return n;
    return n < 0 ? err('#VALUE!') : t.slice(0, n);
  },
  RIGHT: (a, ev) => {
    const t = toText(ev(a[0]));
    const n = a[1] ? toNumber(ev(a[1])) : 1;
    if (isErr(t)) return t;
    if (isErr(n)) return n;
    return n < 0 ? err('#VALUE!') : n === 0 ? '' : t.slice(-n);
  },
  MID: (a, ev) => {
    const t = toText(ev(a[0]));
    const s = needNums(a.slice(1), ev, 2);
    if (isErr(t)) return t;
    if (isErr(s)) return s;
    return s[0] < 1 || s[1] < 0 ? err('#VALUE!') : t.slice(s[0] - 1, s[0] - 1 + s[1]);
  },
  VALUE: (a, ev) => {
    const v = scalar(ev(a[0]));
    const n = toNumber(v);
    return isErr(n) ? n : n;
  },
  TODAY: (_a, _ev, ctx) => dateSerial((ctx.now ?? (() => new Date()))()),
  NOW: (_a, _ev, ctx) => {
    const d = (ctx.now ?? (() => new Date()))();
    return dateSerial(d) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
  },
  DATE: (a, ev) => {
    const n = needNums(a, ev, 3);
    return isErr(n) ? n : Math.floor((Date.UTC(n[0], n[1] - 1, n[2]) - Date.UTC(1899, 11, 30)) / 86400000);
  },
  YEAR: (a, ev) => {
    const n = needNums(a, ev, 1);
    return isErr(n) ? n : serialToDate(n[0]).getUTCFullYear();
  },
  MONTH: (a, ev) => {
    const n = needNums(a, ev, 1);
    return isErr(n) ? n : serialToDate(n[0]).getUTCMonth() + 1;
  },
  DAY: (a, ev) => {
    const n = needNums(a, ev, 1);
    return isErr(n) ? n : serialToDate(n[0]).getUTCDate();
  },
  SUMIF: (a, ev) => {
    if (a.length < 2) return err('#VALUE!');
    const range = ev(a[0]);
    if (!isRange(range)) return err('#VALUE!');
    const crit = scalar(ev(a[1]));
    if (isErr(crit)) return crit;
    const sumRange = a[2] ? ev(a[2]) : range;
    if (!isRange(sumRange)) return err('#VALUE!');
    let sum = 0;
    range.range.forEach((row, r) =>
      row.forEach((v, c) => {
        if (!meets(v, crit)) return;
        const t = sumRange.range[r]?.[c];
        if (typeof t === 'number') sum += t;
      }),
    );
    return sum;
  },
  COUNTIF: (a, ev) => {
    if (a.length < 2) return err('#VALUE!');
    const range = ev(a[0]);
    if (!isRange(range)) return err('#VALUE!');
    const crit = scalar(ev(a[1]));
    if (isErr(crit)) return crit;
    return range.range.flat().filter((v) => meets(v, crit)).length;
  },
  AVERAGEIF: (a, ev) => {
    if (a.length < 2) return err('#VALUE!');
    const range = ev(a[0]);
    if (!isRange(range)) return err('#VALUE!');
    const crit = scalar(ev(a[1]));
    if (isErr(crit)) return crit;
    const avgRange = a[2] ? ev(a[2]) : range;
    if (!isRange(avgRange)) return err('#VALUE!');
    let sum = 0;
    let n = 0;
    range.range.forEach((row, r) =>
      row.forEach((v, c) => {
        if (!meets(v, crit)) return;
        const t = avgRange.range[r]?.[c];
        if (typeof t === 'number') {
          sum += t;
          n++;
        }
      }),
    );
    return n ? sum / n : err('#DIV/0!');
  },
  VLOOKUP: (a, ev) => {
    if (a.length < 3) return err('#VALUE!');
    const key = scalar(ev(a[0]));
    const table = ev(a[1]);
    const col = toNumber(ev(a[2]));
    if (isErr(key)) return key;
    if (!isRange(table)) return err('#VALUE!');
    if (isErr(col)) return col;
    if (col < 1 || col > (table.range[0]?.length ?? 0)) return err('#REF!');
    const row = table.range.find((r) => r[0] !== null && compare(r[0], key) === 0 && typeof r[0] === typeof key);
    return row ? row[col - 1] : err('#N/A');
  },
};
FUNCTIONS.CONCATENATE = FUNCTIONS.CONCAT;
FUNCTIONS.AVG = FUNCTIONS.AVERAGE;

/** The names of the functions, for the "function list" in the formula bar. */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS).filter((n) => n !== 'AVG').sort();

export function evaluate(node: Node, ctx: EvalCtx): Val {
  const ev = (n: Node): Val | Range => {
    switch (n.k) {
      case 'num':
      case 'str':
      case 'bool':
        return n.v;
      case 'err':
        return err(n.code);
      case 'ref':
        return ctx.cell(n.r, n.c);
      case 'range': {
        if ((n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1) > 200_000) return err('#VALUE!');
        const rows: Val[][] = [];
        for (let r = n.r1; r <= n.r2; r++) {
          const row: Val[] = [];
          for (let c = n.c1; c <= n.c2; c++) row.push(ctx.cell(r, c));
          rows.push(row);
        }
        return { range: rows };
      }
      case 'un': {
        const v = toNumber(ev(n.a));
        return isErr(v) ? v : n.op === '-' ? -v : v;
      }
      case 'pct': {
        const v = toNumber(ev(n.a));
        return isErr(v) ? v : v / 100;
      }
      case 'bin': {
        const l = ev(n.a);
        const r = ev(n.b);
        if (n.op === '&') {
          const x = toText(l);
          const y = toText(r);
          return isErr(x) ? x : isErr(y) ? y : x + y;
        }
        if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
          const x = scalar(l);
          const y = scalar(r);
          if (isErr(x)) return x;
          if (isErr(y)) return y;
          const c = compare(x, y);
          return n.op === '=' ? c === 0 : n.op === '<>' ? c !== 0 : n.op === '<' ? c < 0 : n.op === '>' ? c > 0 : n.op === '<=' ? c <= 0 : c >= 0;
        }
        const x = toNumber(l);
        const y = toNumber(r);
        if (isErr(x)) return x;
        if (isErr(y)) return y;
        switch (n.op) {
          case '+':
            return x + y;
          case '-':
            return x - y;
          case '*':
            return x * y;
          case '/':
            return y === 0 ? err('#DIV/0!') : x / y;
          default: {
            const p = x ** y;
            return Number.isFinite(p) ? p : err('#NUM!');
          }
        }
      }
      case 'call': {
        const fn = FUNCTIONS[n.name];
        return fn ? fn(n.args, ev, ctx) : err('#NAME?');
      }
    }
  };
  const out = ev(node);
  if (isRange(out)) return out.range[0]?.[0] ?? null; // a bare range shows its first cell
  if (typeof out === 'number' && !Number.isFinite(out)) return err('#NUM!');
  return out;
}

/* ------------------------------------------------------------------ */
/* Rewriting references (copy, fill, insert and delete rows)           */
/* ------------------------------------------------------------------ */

export interface RefMapper {
  /** A lone reference. Return null for "no longer exists" (becomes #REF!). */
  ref?: (a: RefParts) => RefParts | null;
  /** A range A1:B2. Without this, each end goes through `ref`. */
  range?: (a: RefParts, b: RefParts) => [RefParts, RefParts] | null;
}

const refText = (p: RefParts) => `${p.absC ? '$' : ''}${colName(p.c)}${p.absR ? '$' : ''}${p.r + 1}`;

/** The formula with its references changed by `map`. Text that is not a formula is returned as it is. */
export function mapRefs(formula: string, map: RefMapper): string {
  if (!isFormula(formula)) return formula;
  let toks: Tok[];
  try {
    toks = tokenize(formula.slice(1));
  } catch {
    return formula;
  }
  const body = formula.slice(1);
  let out = '';
  let at = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'ref') continue;
    const isRangeStart = toks[k + 1]?.t === 'op' && toks[k + 1].s === ':' && toks[k + 2]?.t === 'ref';
    if (isRangeStart) {
      const z = toks[k + 2];
      out += body.slice(at, t.i);
      const res = map.range ? map.range(t.ref!, z.ref!) : both(map, t.ref!, z.ref!);
      out += res ? `${refText(res[0])}:${refText(res[1])}` : '#REF!';
      at = z.j;
      k += 2;
    } else {
      out += body.slice(at, t.i);
      const res = map.ref ? map.ref(t.ref!) : t.ref!;
      out += res ? refText(res) : '#REF!';
      at = t.j;
    }
  }
  return '=' + out + body.slice(at);
}

const both = (map: RefMapper, a: RefParts, b: RefParts): [RefParts, RefParts] | null => {
  const x = map.ref ? map.ref(a) : a;
  const y = map.ref ? map.ref(b) : b;
  return x && y ? [x, y] : null;
};

/** The formula as it reads when copied `dr` rows down and `dc` columns right: relative references move, $absolute ones stay. */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  return mapRefs(formula, {
    ref: (p) => {
      const r = p.absR ? p.r : p.r + dr;
      const c = p.absC ? p.c : p.c + dc;
      return r < 0 || c < 0 ? null : { ...p, r, c };
    },
  });
}

/** Rows or columns inserted: every reference at or after `at` moves by `n` (a range across the gap grows). */
export function insertRefs(formula: string, axis: 'row' | 'col', at: number, n: number): string {
  const key = axis === 'row' ? 'r' : 'c';
  return mapRefs(formula, { ref: (p) => (p[key] >= at ? { ...p, [key]: p[key] + n } : p) });
}

/** Rows or columns `at … at+n-1` deleted: references to them become #REF!, later ones move up, a range loses the deleted part. */
export function deleteRefs(formula: string, axis: 'row' | 'col', at: number, n: number): string {
  const key = axis === 'row' ? 'r' : 'c';
  const gone = (v: number) => v >= at && v < at + n;
  return mapRefs(formula, {
    ref: (p) => (gone(p[key]) ? null : p[key] >= at + n ? { ...p, [key]: p[key] - n } : p),
    range: (a, b) => {
      const lo = Math.min(a[key], b[key]);
      const hi = Math.max(a[key], b[key]);
      if (lo >= at && hi < at + n) return null; // the whole range was deleted
      const fix = (v: number, isStart: boolean) => (gone(v) ? (isStart ? at : at - 1) : v >= at + n ? v - n : v);
      const nlo = fix(lo, true);
      const nhi = fix(hi, false);
      if (nhi < nlo) return null;
      const swapped = a[key] > b[key];
      return swapped ? [{ ...a, [key]: nhi }, { ...b, [key]: nlo }] : [{ ...a, [key]: nlo }, { ...b, [key]: nhi }];
    },
  });
}
