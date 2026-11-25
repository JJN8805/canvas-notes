import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { FORMATS, type ElType, type ScriptEl, type ScriptFormat } from '../../lib/script/model';

export interface Row extends ScriptEl {
  id: number;
}

const HIDDEN: ElType[] = ['section', 'synopsis'];

/** How a row looks on the paper: its indent and width in characters come from the format, so the screen matches the printed page. */
export function rowStyle(format: ScriptFormat, type: ElType): CSSProperties {
  const st = FORMATS[format].styles[type];
  const step = FORMATS[format].step;
  return {
    '--ind': st.indent,
    '--w': st.width || 60,
    '--before': st.before,
    '--first': st.first ?? 0,
    '--lh': step === 2 ? 2.4 : 1.3,
    textAlign: st.align ?? 'left',
    fontWeight: st.bold ? 700 : 400,
    fontStyle: st.italic ? 'italic' : 'normal',
    textTransform: st.upper ? 'uppercase' : 'none',
  } as CSSProperties;
}

interface Props {
  row: Row;
  format: ScriptFormat;
  label: string;
  suggestions: string[];
  pageNo: number | null;
  onText: (id: number, text: string) => void;
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>, id: number) => void;
  onFocus: (id: number) => void;
  onPick: (id: number, text: string) => void;
  onRemove: (id: number) => void;
  setRef: (id: number, el: HTMLTextAreaElement | null) => void;
  active: boolean;
}

export function ScriptRow({ row, format, label, suggestions, pageNo, onText, onKey, onFocus, onPick, onRemove, setRef, active }: Props) {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [row.text, row.type, format]);
  return (
    <>
      {pageNo !== null && (
        <div className="sc-page" aria-hidden="true">
          <span>{pageNo}.</span>
        </div>
      )}
      {row.type === 'pagebreak' ? (
        <div className="sc-row sc-break" data-type="pagebreak">
          <span>Page break</span>
          <button className="btn small" onClick={() => onRemove(row.id)} aria-label="Remove page break" title="Remove page break">×</button>
        </div>
      ) : (
        <div className={`sc-row${active ? ' on' : ''}${HIDDEN.includes(row.type) ? ' sc-outline' : ''}`} data-type={row.type} style={rowStyle(format, row.type)}>
          <span className="sc-tag" aria-hidden="true">{label}</span>
          <textarea
            ref={(el) => {
              ta.current = el;
              setRef(row.id, el);
            }}
            className="sc-text"
            rows={1}
            value={row.text}
            spellCheck
            aria-label={label}
            placeholder={active ? label : ''}
            onChange={(e) => onText(row.id, e.target.value)}
            onKeyDown={(e) => onKey(e, row.id)}
            onFocus={() => onFocus(row.id)}
          />
          {active && suggestions.length > 0 && (
            <div className="sc-suggest" role="listbox" aria-label="Suggestions">
              {suggestions.map((s, k) => (
                <button key={s} role="option" aria-selected={k === 0} className={k === 0 ? 'first' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(row.id, s)}>
                  {s}
                  {k === 0 && <kbd>Tab</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
