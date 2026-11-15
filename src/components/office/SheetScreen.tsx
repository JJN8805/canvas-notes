import { useCallback, useMemo, useRef, useState } from 'react';
import type { CellFormat, NoteColor } from '../../types';
import { sheetBlock } from '../../lib/office/app';
import { cellName, colName } from '../../lib/office/formula';
import {
  clearCells, computeGrid, copyCells, deleteLines, ensureSize, fillRange, formatCells, formatValue, insertLines, MAX_COLS, MAX_ROWS, parseCsv, pasteCells,
  rangeStats, sortRows, toCsv, usedRange, type Clip, type GridState, type Pos, type Rect,
} from '../../lib/office/sheetModel';
import { afterCommit, fromTsv, isSingle, move, rectOf, single, toTsv, type Dir, type Sel } from '../../lib/office/sheetNav';
import { editSheet, setFreeze } from '../../store/office';
import { redo, undo, useNotes } from '../../store/notes';
import { confirmDanger, openMenu, toast } from '../../store/ui';
import { noteVar } from '../../lib/colors';
import { Icon } from '../ui/Icon';
import { SheetGrid, type Editing } from './SheetGrid';

const NUMBER_FORMATS: [string, CellFormat['nf']][] = [['General', undefined], ['Number', 'num'], ['Whole number', 'int'], ['Currency', 'cur'], ['Percent', 'pct'], ['Date', 'date']];

/** A spreadsheet: a formula bar, a toolbar, the cells and a status bar with the sum and average of what is selected. */
export function SheetScreen({ pageId }: { pageId: string }) {
  const block = useNotes((s) => sheetBlock(s.pages[pageId]?.blocks ?? []));
  if (!block) return null;
  return <Sheet pageId={pageId} rowsRaw={block.rows} fmt={block.calc?.fmt ?? {}} colW={block.calc?.colW ?? {}} freeze={block.calc?.freeze ?? 0} />;
}

function Sheet({ pageId, rowsRaw, fmt, colW, freeze }: { pageId: string; rowsRaw: string[][]; fmt: Record<string, CellFormat>; colW: Record<string, number>; freeze: number }) {
  const [sel, setSel] = useState<Sel>(single({ r: 0, c: 0 }));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [scroll, setScrollState] = useState({ top: 0, height: 600 });
  const clip = useRef<{ clip: Clip; text: string } | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const used = useMemo(() => usedRange(rowsRaw), [rowsRaw]);
  const shape = useMemo(() => ensureSize(rowsRaw, Math.min(MAX_ROWS, Math.max(60, used.rows + 20)), Math.min(MAX_COLS, Math.max(14, used.cols + 4))), [rowsRaw, used]);
  const values = useMemo(() => computeGrid(shape), [shape]);
  const bounds = { rows: shape.length, cols: shape[0]?.length ?? 1 };
  const rect = rectOf(sel);
  const active = sel.focus;
  const raw = rowsRaw[active.r]?.[active.c] ?? '';
  const state = (): GridState => ({ rows: rowsRaw, fmt, colW });
  const run = (change: (s: GridState) => GridState) => editSheet(pageId, change);

  const setScroll = useCallback((top: number, height: number) => setScrollState((s) => (s.top === top && s.height === height ? s : { top, height })), []);

  const commit = (draft: string, how: 'enter' | 'shift-enter' | 'tab' | 'shift-tab' | 'none') => {
    setEditing(null);
    if (draft !== raw) {
      const { r, c } = active;
      run((s) => {
        const rows = ensureSize(s.rows.map((x) => [...x]), r + 1, c + 1);
        rows[r][c] = draft;
        return { ...s, rows };
      });
    }
    if (how !== 'none') setSel((s) => afterCommit(s, how, bounds));
  };

  const withFormat = (patch: Partial<Record<keyof CellFormat, CellFormat[keyof CellFormat] | undefined>>) => run((s) => formatCells(s, rect, patch));
  const every = (key: keyof CellFormat, v: unknown) => {
    for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) if (fmt[cellName(r, c)]?.[key] !== v) return false;
    return true;
  };
  const toggle = (key: 'b' | 'i') => withFormat({ [key]: every(key, 1) ? undefined : 1 });
  const decimals = (d: number) => {
    const cur = fmt[cellName(active.r, active.c)];
    withFormat({ dec: Math.max(0, Math.min(10, (cur?.dec ?? 2) + d)), nf: cur?.nf ?? 'num' });
  };

  const sortBy = (dir: 'asc' | 'desc') => {
    const body: Rect = isSingle(sel)
      ? { r1: Math.min(freeze, used.rows - 1), c1: 0, r2: used.rows - 1, c2: used.cols - 1 }
      : { r1: Math.min(rect.r1 + (freeze > rect.r1 ? freeze - rect.r1 : 0), rect.r2), c1: rect.c1, r2: rect.r2, c2: rect.c2 };
    if (body.r2 <= body.r1) return;
    run((s) => sortRows({ ...s, rows: ensureSize(s.rows.map((x) => [...x]), body.r2 + 1, body.c2 + 1) }, body, active.c, dir));
  };

  const doCopy = (cut: boolean): string => {
    const c = copyCells(state(), rect);
    const text = toTsv(c.cells.map((row, i) => row.map((_, j) => formatValue(values[rect.r1 + i]?.[rect.c1 + j] ?? null, fmt[cellName(rect.r1 + i, rect.c1 + j)]))));
    clip.current = { clip: c, text };
    if (cut) run((s) => clearCells(s, rect));
    return text;
  };
  const paste = (text: string) => {
    const mine = clip.current && clip.current.text === text ? clip.current.clip : null;
    const cells = mine ?? ({ cells: fromTsv(text), fmts: [], origin: active } as Clip);
    run((s) => pasteCells(s, { r: rect.r1, c: rect.c1 }, cells));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const dirs: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (dirs[key]) {
      e.preventDefault();
      setSel((s) => move(s, dirs[key], { extend: e.shiftKey, edge: mod, bounds, filled: (p) => (rowsRaw[p.r]?.[p.c] ?? '') !== '' }));
    } else if (key === 'Tab') {
      e.preventDefault();
      setSel((s) => afterCommit(s, e.shiftKey ? 'shift-tab' : 'tab', bounds));
    } else if (key === 'Enter' || key === 'F2') {
      e.preventDefault();
      if (key === 'Enter' && !isSingle(sel)) setSel((s) => ({ ...s, focus: { r: s.focus.r + (e.shiftKey ? -1 : 1) < 0 ? 0 : Math.min(bounds.rows - 1, s.focus.r + (e.shiftKey ? -1 : 1)), c: s.focus.c } }));
      else setEditing({ draft: raw, from: 'cell' });
    } else if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      run((s) => clearCells(s, rect));
    } else if (key === 'Escape') {
      setSel((s) => single(s.focus));
    } else if (mod && key.toLowerCase() === 'a') {
      e.preventDefault();
      setSel({ anchor: { r: 0, c: 0 }, focus: { r: Math.max(0, used.rows - 1), c: Math.max(0, used.cols - 1) } });
    } else if (mod && key.toLowerCase() === 'b') {
      e.preventDefault();
      toggle('b');
    } else if (mod && key.toLowerCase() === 'i') {
      e.preventDefault();
      toggle('i');
    } else if (mod && key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(pageId);
      else undo(pageId);
    } else if (mod && key.toLowerCase() === 'y') {
      e.preventDefault();
      redo(pageId);
    } else if (mod && (key.toLowerCase() === 'd' || key.toLowerCase() === 'r')) {
      e.preventDefault();
      const down = key.toLowerCase() === 'd';
      if (down ? rect.r2 > rect.r1 : rect.c2 > rect.c1) {
        const src: Rect = down ? { ...rect, r2: rect.r1 } : { ...rect, c2: rect.c1 };
        const to: Pos = down ? { r: rect.r2, c: rect.c2 } : { r: rect.r2, c: rect.c2 };
        run((s) => fillRange(s, src, to));
      }
    } else if (!mod && !e.altKey && key.length === 1) {
      e.preventDefault();
      setEditing({ draft: key, from: 'cell' }); // typing on a cell replaces what is in it
    }
  };

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    if (fileRef.current) fileRef.current.value = '';
    const rows = parseCsv(await file.text());
    if (rowsRaw.some((r) => r.some((c) => c !== '')) && !(await confirmDanger('Replace this sheet?', 'The cells are replaced by the file’s. You can undo this.', 'Replace'))) return;
    run((s) => ({ ...s, rows: ensureSize(rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS)), 1, 1) }));
    setSel(single({ r: 0, c: 0 }));
  };
  const exportCsv = () => {
    const u = usedRange(rowsRaw);
    const out = rowsRaw.slice(0, u.rows).map((r) => r.slice(0, u.cols).map((_, c) => c)).map((cols, r) => cols.map((c) => formatValue(values[r]?.[c] ?? null, fmt[cellName(r, c)])));
    const url = URL.createObjectURL(new Blob([toCsv(out)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'spreadsheet.csv' });
    a.click();
    URL.revokeObjectURL(url);
    toast('Saved as spreadsheet.csv (values as shown)');
  };

  const stats = useMemo(() => (isSingle(sel) ? null : rangeStats(values, rect)), [sel, values, rect.r1, rect.c1, rect.r2, rect.c2]); // eslint-disable-line react-hooks/exhaustive-deps
  const btn = (label: string, content: React.ReactNode, run: () => void, on = false) => (
    <button className={`sb${on ? ' on' : ''}`} aria-label={label} title={label} aria-pressed={on || undefined} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {content}
    </button>
  );
  const nf = fmt[cellName(active.r, active.c)]?.nf;
  const al = fmt[cellName(active.r, active.c)]?.al;

  return (
    <div className="sheet-screen" onKeyDown={onKeyDown} onCopy={(e) => { if ((e.target as HTMLElement).tagName === 'INPUT') return; e.preventDefault(); e.clipboardData.setData('text/plain', doCopy(false)); }}
      onCut={(e) => { if ((e.target as HTMLElement).tagName === 'INPUT') return; e.preventDefault(); e.clipboardData.setData('text/plain', doCopy(true)); }}
      onPaste={(e) => { if ((e.target as HTMLElement).tagName === 'INPUT') return; e.preventDefault(); paste(e.clipboardData.getData('text/plain')); }}>
      <div className="sheet-tools" role="toolbar" aria-label="Spreadsheet tools">
        {btn('Undo', <Icon name="undo" size={16} />, () => undo(pageId))}
        {btn('Redo', <Icon name="redo" size={16} />, () => redo(pageId))}
        <span className="sep" />
        {btn('Bold (Ctrl+B)', <b>B</b>, () => toggle('b'), every('b', 1))}
        {btn('Italic (Ctrl+I)', <i>I</i>, () => toggle('i'), every('i', 1))}
        {btn('Align left', 'L', () => withFormat({ al: al === 'l' ? undefined : 'l' }), al === 'l')}
        {btn('Align centre', 'C', () => withFormat({ al: al === 'c' ? undefined : 'c' }), al === 'c')}
        {btn('Align right', 'R', () => withFormat({ al: al === 'r' ? undefined : 'r' }), al === 'r')}
        <span className="sep" />
        <select className="field small" aria-label="Number format" value={nf ?? ''} onChange={(e) => withFormat({ nf: (e.target.value || undefined) as CellFormat['nf'] })}>
          {NUMBER_FORMATS.map(([label, v]) => <option key={label} value={v ?? ''}>{label}</option>)}
        </select>
        {btn('Fewer decimals', '.0', () => decimals(-1))}
        {btn('More decimals', '.00', () => decimals(1))}
        {btn('Fill colour', <span className="swatch-dot" style={{ background: fmt[cellName(active.r, active.c)]?.bg ? noteVar(fmt[cellName(active.r, active.c)]!.bg as NoteColor) : 'transparent' }} />, () => {
          const anchor = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
          openMenu(anchor, [{ colors: true, title: 'Fill colour', current: (fmt[cellName(active.r, active.c)]?.bg as NoteColor | undefined) ?? null, pick: (c: NoteColor | null) => withFormat({ bg: c ?? undefined }) }]);
        })}
        <span className="sep" />
        {btn('Insert row above', '+Row', () => run((s) => insertLines(s, 'row', rect.r1)))}
        {btn('Insert column left', '+Col', () => run((s) => insertLines(s, 'col', rect.c1)))}
        {btn('Delete the selected rows', '−Row', () => run((s) => deleteLines(s, 'row', rect.r1, rect.r2 - rect.r1 + 1)))}
        {btn('Delete the selected columns', '−Col', () => run((s) => deleteLines(s, 'col', rect.c1, rect.c2 - rect.c1 + 1)))}
        <span className="sep" />
        {btn('Sort A to Z by this column', 'A→Z', () => sortBy('asc'))}
        {btn('Sort Z to A by this column', 'Z→A', () => sortBy('desc'))}
        {btn(freeze ? 'Unfreeze the top row' : 'Freeze the top row', 'Freeze', () => setFreeze(pageId, freeze ? 0 : 1), freeze > 0)}
        <span className="sep" />
        {btn('Open a CSV file', 'Import', () => fileRef.current?.click())}
        {btn('Save as CSV', 'Export', exportCsv)}
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={(e) => void importCsv(e.target.files?.[0])} />
      </div>
      <div className="sheet-bar">
        <span className="sheet-name" aria-label="Selected cell">{isSingle(sel) ? cellName(active.r, active.c) : `${cellName(rect.r1, rect.c1)}:${cellName(rect.r2, rect.c2)}`}</span>
        <span className="fx" aria-hidden="true">fx</span>
        <input
          className="sheet-formula"
          aria-label="Formula bar"
          value={editing ? editing.draft : raw}
          onFocus={() => !editing && setEditing({ draft: raw, from: 'bar' })}
          onChange={(e) => setEditing({ draft: e.target.value, from: 'bar' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(editing?.draft ?? raw, 'enter');
            else if (e.key === 'Escape') setEditing(null);
            else return;
            e.preventDefault();
            focusRef.current?.focus();
          }}
          onBlur={() => editing?.from === 'bar' && commit(editing.draft, 'none')}
        />
      </div>
      <SheetGrid
        rows={shape}
        values={values}
        fmt={fmt}
        colW={colW}
        freeze={freeze}
        sel={sel}
        setSel={setSel}
        editing={editing}
        setEditing={setEditing}
        scrollTop={scroll.top}
        setScroll={setScroll}
        onCommit={commit}
        onResize={(c, w) => run((s) => ({ ...s, colW: { ...s.colW, [String(c)]: w } }))}
        focusRef={focusRef}
      />
      <div className="sheet-status" role="status">
        {stats ? (
          <>
            <span>Count {stats.count}</span>
            {stats.numbers > 0 && (
              <>
                <span>Sum {Number(stats.sum.toFixed(10)).toLocaleString()}</span>
                <span>Average {Number((stats.avg ?? 0).toFixed(10)).toLocaleString()}</span>
                <span>Min {stats.min}</span>
                <span>Max {stats.max}</span>
              </>
            )}
          </>
        ) : (
          <span>{used.rows} {used.rows === 1 ? 'row' : 'rows'} × {used.cols} {used.cols === 1 ? 'column' : 'columns'} · {colName(used.cols - 1 < 0 ? 0 : used.cols - 1)}{used.rows} is the last used cell</span>
        )}
      </div>
    </div>
  );
}
