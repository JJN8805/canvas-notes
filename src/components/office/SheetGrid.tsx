import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { CellFormat } from '../../types';
import { noteVar } from '../../lib/colors';
import { cellName, colName, isErr, type Val } from '../../lib/office/formula';
import { alignOf, formatValue } from '../../lib/office/sheetModel';
import { isSingle, rectOf, single, visibleRows, type Sel } from '../../lib/office/sheetNav';

export const ROW_H = 24;
export const HEAD_H = 26;
export const NUM_W = 48;
export const DEFAULT_COL_W = 100;

export interface Editing {
  draft: string;
  /** Where the typing happens: in the cell itself or in the formula bar. */
  from: 'cell' | 'bar';
}

interface Props {
  rows: string[][];
  values: Val[][];
  fmt: Record<string, CellFormat>;
  colW: Record<string, number>;
  freeze: number;
  sel: Sel;
  setSel: Dispatch<SetStateAction<Sel>>;
  editing: Editing | null;
  setEditing: Dispatch<SetStateAction<Editing | null>>;
  scrollTop: number;
  setScroll: (top: number, height: number) => void;
  onCommit: (draft: string, how: 'enter' | 'shift-enter' | 'tab' | 'shift-tab' | 'none') => void;
  onResize: (col: number, width: number) => void;
  focusRef: React.RefObject<HTMLDivElement | null>;
}

/** The cells: a header row of letters, a column of numbers, and only the rows in view (a spreadsheet can have a thousand). */
export function SheetGrid(p: Props) {
  const { rows, values, fmt, colW, freeze, sel, editing } = p;
  const cols = rows[0]?.length ?? 0;
  const scroller = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { from, to } = visibleRows(p.scrollTop, scroller.current?.clientHeight ?? 600, ROW_H, rows.length);
  const rect = rectOf(sel);
  const widthOf = (c: number) => colW[String(c)] ?? DEFAULT_COL_W;

  useEffect(() => {
    const el = scroller.current;
    if (el) p.setScroll(el.scrollTop, el.clientHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (editing?.from === 'cell') inputRef.current?.focus();
  }, [editing?.from]);

  // Keep the cursor cell in view when it moves by keyboard.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const top = sel.focus.r * ROW_H;
    const frozenH = freeze * ROW_H;
    if (sel.focus.r >= freeze) {
      if (top < el.scrollTop + frozenH) el.scrollTop = Math.max(0, top - frozenH);
      else if (top + ROW_H > el.scrollTop + el.clientHeight - HEAD_H) el.scrollTop = top + ROW_H - el.clientHeight + HEAD_H;
    }
    let left = NUM_W;
    for (let c = 0; c < sel.focus.c; c++) left += widthOf(c);
    const w = widthOf(sel.focus.c);
    if (left - NUM_W < el.scrollLeft) el.scrollLeft = left - NUM_W;
    else if (left + w > el.scrollLeft + el.clientWidth) el.scrollLeft = left + w - el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.focus.r, sel.focus.c]);

  const select = (r: number, c: number, extend: boolean) => p.setSel((s) => (extend ? { anchor: s.anchor, focus: { r, c } } : single({ r, c })));
  const total = Array.from({ length: cols }, (_, c) => widthOf(c)).reduce((a, b) => a + b, NUM_W);

  const cell = (r: number, c: number) => {
    const raw = rows[r]?.[c] ?? '';
    const f = fmt[cellName(r, c)];
    const v = values[r]?.[c] ?? null;
    const active = sel.focus.r === r && sel.focus.c === c;
    const inSel = r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
    const al = alignOf(v, f);
    const style = { background: f?.bg ? `color-mix(in srgb, ${noteVar(f.bg)} 55%, var(--sheet))` : undefined, fontWeight: f?.b ? 700 : undefined, fontStyle: f?.i ? 'italic' : undefined, textAlign: al === 'l' ? 'left' : al === 'r' ? 'right' : 'center' } as const;
    const editingHere = editing?.from === 'cell' && active;
    return (
      <td
        key={c}
        data-r={r}
        data-c={c}
        className={`sc${inSel ? ' in' : ''}${active ? ' active' : ''}${isErr(v) ? ' err' : ''}`}
        style={style}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if (editing && !(editing.from === 'cell' && active)) p.onCommit(editing.draft, 'none');
          if (editingHere) return;
          dragging.current = true;
          select(r, c, e.shiftKey);
          p.focusRef.current?.focus();
        }}
        onMouseEnter={(e) => dragging.current && e.buttons === 1 && select(r, c, true)}
        onDoubleClick={() => p.setEditing({ draft: raw, from: 'cell' })}
      >
        {editingHere ? (
          <input
            ref={inputRef}
            className="sc-input"
            aria-label={`Edit ${cellName(r, c)}`}
            value={editing.draft}
            onChange={(e) => p.setEditing({ draft: e.target.value, from: 'cell' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') p.onCommit(editing.draft, e.shiftKey ? 'shift-enter' : 'enter');
              else if (e.key === 'Tab') p.onCommit(editing.draft, e.shiftKey ? 'shift-tab' : 'tab');
              else if (e.key === 'Escape') p.setEditing(null);
              else return;
              e.preventDefault();
              e.stopPropagation();
              p.focusRef.current?.focus();
            }}
          />
        ) : (
          formatValue(v, f)
        )}
      </td>
    );
  };

  const body: React.ReactNode[] = [];
  const row = (r: number, sticky: boolean) => (
    <tr key={r} style={{ height: ROW_H }} className={sticky ? 'frozen' : undefined}>
      <th
        className={`rh${r >= rect.r1 && r <= rect.r2 ? ' on' : ''}`}
        style={sticky ? { top: HEAD_H + r * ROW_H } : undefined}
        onMouseDown={() => p.setSel({ anchor: { r, c: 0 }, focus: { r, c: Math.max(0, cols - 1) } })}
      >
        {r + 1}
      </th>
      {Array.from({ length: cols }, (_, c) => cell(r, c))}
    </tr>
  );
  for (let r = 0; r < Math.min(freeze, rows.length); r++) body.push(row(r, true));
  const start = Math.max(from, freeze);
  if (start > freeze) body.push(<tr key="top" style={{ height: (start - freeze) * ROW_H }} aria-hidden="true" />);
  for (let r = start; r < to; r++) body.push(row(r, false));
  if (to < rows.length) body.push(<tr key="bottom" style={{ height: (rows.length - to) * ROW_H }} aria-hidden="true" />);

  return (
    <div
      ref={scroller}
      className="sheet-scroll"
      onScroll={(e) => p.setScroll(e.currentTarget.scrollTop, e.currentTarget.clientHeight)}
      onMouseUp={() => (dragging.current = false)}
      onMouseLeave={() => (dragging.current = false)}
    >
      <div ref={p.focusRef} className="sheet-focus" tabIndex={0} aria-label="Spreadsheet cells" role="grid" aria-rowcount={rows.length} aria-colcount={cols}>
        <table className="sheet-table" style={{ width: total }}>
          <colgroup>
            <col style={{ width: NUM_W }} />
            {Array.from({ length: cols }, (_, c) => (
              <col key={c} style={{ width: widthOf(c) }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ height: HEAD_H }}>
              <th className="corner" onMouseDown={() => p.setSel({ anchor: { r: 0, c: 0 }, focus: { r: Math.max(0, rows.length - 1), c: Math.max(0, cols - 1) } })} aria-label="Select all" />
              {Array.from({ length: cols }, (_, c) => (
                <th
                  key={c}
                  className={`ch${c >= rect.c1 && c <= rect.c2 ? ' on' : ''}`}
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).classList.contains('grip')) return;
                    p.setSel({ anchor: { r: 0, c }, focus: { r: Math.max(0, rows.length - 1), c } });
                  }}
                >
                  {colName(c)}
                  <span
                    className="grip"
                    role="separator"
                    aria-label={`Resize column ${colName(c)}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      const startX = e.clientX;
                      const startW = widthOf(c);
                      const move = (m: PointerEvent) => p.onResize(c, Math.max(32, Math.min(600, Math.round(startW + m.clientX - startX))));
                      const up = () => {
                        window.removeEventListener('pointermove', move);
                        window.removeEventListener('pointerup', up);
                      };
                      window.addEventListener('pointermove', move);
                      window.addEventListener('pointerup', up);
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    </div>
  );
}

export { isSingle };
