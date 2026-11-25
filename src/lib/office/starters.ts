/**
 * The ways to start a Workspace page (pure): blank, or from a ready-made starter. Each builds the boxes of a new page; the ids come
 * from `prefix`, so the same starter built twice gives the same ids (the Workspace uses that to ship them as templates too).
 */
import type { Block, CellFormat, NoteColor, TableBlock, NoteBlock } from '../../types';
import { builder, type Built } from '../templateKit';
import { slideBlocks, type OfficeApp, type SlideLayout, type SlideText, SLIDE_GAP, SLIDE_H } from './app';
import { ensureSize } from './sheetModel';
import { cellName } from './formula';
import { SCRIPT_STARTERS, starterText, type ScriptStarter } from '../script/starters';

export interface Starter {
  id: string;
  app: OfficeApp;
  title: string;
  description: string;
  build: (prefix: string) => Built;
}

/* ---------------- documents ---------------- */

export const DOC_WIDTH = { letter: 816, a4: 794 } as const;

function docPage(prefix: string, title: string, html: string): Built {
  const b = builder(prefix);
  b.add({ type: 'note', style: 'text', x: 0, y: 0, w: DOC_WIDTH.letter, h: 600, html, doc: { page: true } } as never);
  return { title, blocks: b.blocks, arrows: [] };
}

const BLANK_DOC = '<p></p>';

const REPORT = `<h1>Report title</h1><p><em>Prepared by … · Date …</em></p>
<h2>Summary</h2><p>Write the main finding in two or three sentences. A reader who stops here should still know what to do.</p>
<h2>Background</h2><p>Why this was looked at, and what was known before.</p>
<h2>Findings</h2><ul><li><p>First finding, with the number or example that shows it.</p></li><li><p>Second finding.</p></li><li><p>Third finding.</p></li></ul>
<h2>Recommendations</h2><ol><li><p>What to do first, and who does it.</p></li><li><p>What to do next.</p></li></ol>
<h2>Next steps</h2><p>Dates, owners and what you need from the reader.</p>`;

const LETTER = `<p style="text-align: right">Your name<br>Your address<br>Date</p>
<p>Recipient’s name<br>Their address</p>
<p><strong>Subject: what this letter is about</strong></p>
<p>Dear …,</p>
<p>Open with the reason you are writing. Keep the first paragraph to one or two sentences.</p>
<p>Use the next paragraphs for the details, one idea in each, and finish with what you would like to happen next.</p>
<p>Yours sincerely,</p><p></p><p>Your name</p>`;

const MINUTES = `<h1>Meeting minutes</h1><p><strong>Date:</strong> … &nbsp; <strong>Time:</strong> … &nbsp; <strong>Place:</strong> …</p><p><strong>Present:</strong> … &nbsp; <strong>Apologies:</strong> …</p>
<h2>Agenda</h2><ol><li><p>Item one</p></li><li><p>Item two</p></li></ol>
<h2>Discussion and decisions</h2><p>What was said, and what was decided.</p>
<h2>Actions</h2><ul><li><p>Who — what — by when</p></li></ul>
<p><strong>Next meeting:</strong> …</p>`;

/* ---------------- spreadsheets ---------------- */

const GRID_ROWS = 100;
const GRID_COLS = 26;

function sheetPage(prefix: string, title: string, cells: string[][], fmt: Record<string, CellFormat>, colW: Record<string, number> = {}, freeze = 0): Built {
  const b = builder(prefix);
  b.add({
    type: 'table',
    x: 0,
    y: 0,
    w: 1400,
    h: 640,
    rows: ensureSize(cells, GRID_ROWS, GRID_COLS),
    calc: { page: true, ...(Object.keys(fmt).length ? { fmt } : {}), ...(Object.keys(colW).length ? { colW } : {}), ...(freeze ? { freeze } : {}) },
  } as never);
  return { title, blocks: b.blocks, arrows: [] };
}

const head = (n: number, bg: NoteColor = 'blue'): Record<string, CellFormat> => Object.fromEntries(Array.from({ length: n }, (_, c) => [cellName(0, c), { b: 1, bg } as CellFormat]));
const fmtRange = (r1: number, r2: number, c: number, f: CellFormat): Record<string, CellFormat> => Object.fromEntries(Array.from({ length: r2 - r1 + 1 }, (_, i) => [cellName(r1 + i, c), f]));

function budget(prefix: string): Built {
  const rows: string[][] = [['Category', 'Planned', 'Actual', 'Difference', 'Status']];
  const items: [string, number, number][] = [['Rent', 1200, 1200], ['Groceries', 400, 455], ['Transport', 120, 98], ['Utilities', 150, 162], ['Insurance', 90, 90], ['Eating out', 100, 140], ['Savings', 300, 300]];
  items.forEach(([name, planned, actual], i) => {
    const r = i + 2;
    rows.push([name, String(planned), String(actual), `=C${r}-B${r}`, `=IF(D${r}>0,"Over",IF(D${r}<0,"Under","On plan"))`]);
  });
  const last = items.length + 1;
  rows.push(['Total', `=SUM(B2:B${last})`, `=SUM(C2:C${last})`, `=C${last + 1}-B${last + 1}`, `=IF(D${last + 1}>0,"Over budget","Within budget")`]);
  const fmt = { ...head(5), ...fmtRange(1, last + 1, 1, { nf: 'cur', dec: 0 }), ...fmtRange(1, last + 1, 2, { nf: 'cur', dec: 0 }), ...fmtRange(1, last + 1, 3, { nf: 'cur', dec: 0 }), ...Object.fromEntries([0, 1, 2, 3, 4].map((c) => [cellName(last, c), { b: 1, bg: 'yellow', ...(c >= 1 && c <= 3 ? { nf: 'cur', dec: 0 } : {}) } as CellFormat])) };
  return sheetPage(prefix, 'Monthly budget', rows, fmt, { '0': 150, '4': 130 }, 1);
}

function tracker(prefix: string): Built {
  const rows: string[][] = [
    ['Task', 'Owner', 'Due', 'Priority', 'Status'],
    ['Plan the launch', 'Sam', '2026-12-01', 'High', 'In progress'],
    ['Write the announcement', 'Alex', '2026-12-05', 'Medium', 'To do'],
    ['Book the venue', 'Sam', '2026-11-20', 'High', 'Done'],
    ['Order the signs', 'Jo', '2026-11-28', 'Low', 'To do'],
  ];
  rows.push([], ['Done', '=COUNTIF(E2:E50,"Done")'], ['In progress', '=COUNTIF(E2:E50,"In progress")'], ['To do', '=COUNTIF(E2:E50,"To do")'], ['Share done', '=B7/(B7+B8+B9)']);
  const fmt = { ...head(5, 'green'), B10: { nf: 'pct' } as CellFormat, ...Object.fromEntries([6, 7, 8, 9].map((r) => [cellName(r, 0), { b: 1 } as CellFormat])) };
  return sheetPage(prefix, 'Task tracker', rows.map((r) => [...r]), fmt, { '0': 200, '1': 110, '2': 110, '3': 90, '4': 120 }, 1);
}

function gradebook(prefix: string): Built {
  const rows: string[][] = [['Student', 'Quiz 1', 'Quiz 2', 'Exam', 'Average', 'Grade']];
  const marks: [string, number, number, number][] = [['Ada', 92, 88, 95], ['Ben', 71, 64, 70], ['Cleo', 85, 90, 78], ['Dev', 58, 62, 66]];
  marks.forEach(([n, a, b, c], i) => {
    const r = i + 2;
    rows.push([n, String(a), String(b), String(c), `=ROUND(AVERAGE(B${r}:D${r}),1)`, `=IF(E${r}>=90,"A",IF(E${r}>=80,"B",IF(E${r}>=70,"C","D")))`]);
  });
  const last = marks.length + 1;
  rows.push(['Class average', `=ROUND(AVERAGE(B2:B${last}),1)`, `=ROUND(AVERAGE(C2:C${last}),1)`, `=ROUND(AVERAGE(D2:D${last}),1)`, `=ROUND(AVERAGE(E2:E${last}),1)`, '']);
  const fmt = { ...head(6, 'purple'), ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((c) => [cellName(last, c), { b: 1, bg: 'gray' } as CellFormat])) };
  return sheetPage(prefix, 'Gradebook', rows, fmt, { '0': 140 }, 1);
}

/* ---------------- presentations ---------------- */

function deck(prefix: string, title: string, slides: [SlideLayout, SlideText][]): Built {
  const b = builder(prefix);
  slides.forEach(([layout, text], i) => {
    for (const blk of slideBlocks(layout, { x: 0, y: i * (SLIDE_H + SLIDE_GAP) }, b.id, text)) {
      b.blocks.push({ ...blk, z: b.blocks.length + 1 } as Block);
    }
  });
  return { title, blocks: b.blocks, arrows: [] };
}

function scriptPage(prefix: string, s: ScriptStarter): Built {
  const b = builder(prefix);
  b.add({ type: 'note', style: 'code', x: 0, y: 0, w: 640, h: 600, html: '', code: starterText(s), script: { page: true, format: s.format } } as never);
  return { title: s.doc().meta.find(([k]) => k === 'Title')?.[1] || s.title, blocks: b.blocks, arrows: [] };
}

export const STARTERS: Starter[] = [
  ...SCRIPT_STARTERS.map((s): Starter => ({ id: s.id, app: 'script', title: s.title, description: s.description, build: (p) => scriptPage(p, s) })),
  { id: 'doc-blank', app: 'doc', title: 'Blank document', description: 'An empty page to write on.', build: (p) => docPage(p, 'Untitled document', BLANK_DOC) },
  { id: 'doc-report', app: 'doc', title: 'Report', description: 'Summary, findings and recommendations.', build: (p) => docPage(p, 'Report', REPORT) },
  { id: 'doc-letter', app: 'doc', title: 'Letter', description: 'A formal letter with the usual layout.', build: (p) => docPage(p, 'Letter', LETTER) },
  { id: 'doc-minutes', app: 'doc', title: 'Meeting minutes', description: 'Who came, what was decided, who does what.', build: (p) => docPage(p, 'Meeting minutes', MINUTES) },
  { id: 'sheet-blank', app: 'sheet', title: 'Blank spreadsheet', description: 'Rows and columns with formulas.', build: (p) => sheetPage(p, 'Untitled spreadsheet', [['']], {}) },
  { id: 'sheet-budget', app: 'sheet', title: 'Monthly budget', description: 'Planned against actual, with totals.', build: budget },
  { id: 'sheet-tracker', app: 'sheet', title: 'Task tracker', description: 'Tasks, owners and a live count of what is done.', build: tracker },
  { id: 'sheet-gradebook', app: 'sheet', title: 'Gradebook', description: 'Marks, averages and letter grades.', build: gradebook },
  { id: 'slides-blank', app: 'slides', title: 'Blank presentation', description: 'One title slide to begin with.', build: (p) => deck(p, 'Untitled presentation', [['title', { title: 'Presentation title', lines: ['Your name · Date'] }]]) },
  {
    id: 'slides-pitch',
    app: 'slides',
    title: 'Pitch',
    description: 'Problem, solution, how it works and the ask.',
    build: (p) =>
      deck(p, 'Pitch', [
        ['title', { title: 'Your idea in a few words', lines: ['A one-line promise'] }],
        ['content', { title: 'The problem', lines: ['Who has it', 'How they cope today', 'What that costs them'] }],
        ['two', { title: 'Our answer', lines: ['What it is', 'What makes it different', 'Who it is for', 'How it feels to use'] }],
        ['content', { title: 'How it works', lines: ['Step one', 'Step two', 'Step three'] }],
        ['section', { title: 'What we ask for', lines: ['A decision, a date and a next step'] }],
      ]),
  },
  {
    id: 'slides-lesson',
    app: 'slides',
    title: 'Lesson',
    description: 'Goals, ideas, an activity and a recap.',
    build: (p) =>
      deck(p, 'Lesson', [
        ['title', { title: 'Lesson title', lines: ['Subject · Class · Date'] }],
        ['content', { title: 'By the end you will…', lines: ['Know …', 'Be able to …', 'Understand why …'] }],
        ['two', { title: 'The key ideas', lines: ['Idea one', 'Idea two', 'Example one', 'Example two'] }],
        ['section', { title: 'Your turn', lines: ['What to do, and for how long'] }],
        ['content', { title: 'Recap', lines: ['What we covered', 'What to remember', 'What comes next'] }],
      ]),
  },
];

export const starterById = (id: string) => STARTERS.find((s) => s.id === id);
export const startersFor = (app: OfficeApp) => STARTERS.filter((s) => s.app === app);

/** Type guard helpers for callers that need the marked box of a freshly built page. */
export type { TableBlock, NoteBlock };
