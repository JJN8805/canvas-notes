import { useEffect, useMemo, useRef, useState } from 'react';
import { useNotes, openDailyPage } from '../../store/notes';
import { navigate } from '../../lib/route';
import { dateKey, datesWithPages, fromKey, monthGrid, monthTitle, WEEK_HEADS } from '../../lib/daily';
import { Icon } from './Icon';

/** Opens (creating if needed) the daily page for a date. */
export function goToDay(date: string) {
  navigate({ name: 'page', id: openDailyPage(date).id });
}

/** A button that opens a month calendar; days that have a daily page carry a dot. Choosing a day opens it. */
export function CalendarButton({ selected, label = 'Calendar', align = 'right' }: { selected?: string | null; label?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <span className="cal-wrap" ref={wrap}>
      <button className="btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className={'cal-pop ' + align} role="dialog" aria-label="Calendar">
          <Month selected={selected ?? null} onPick={(k) => { setOpen(false); goToDay(k); }} />
        </div>
      )}
    </span>
  );
}

function Month({ selected, onPick }: { selected: string | null; onPick: (key: string) => void }) {
  const pages = useNotes((s) => s.pages);
  const have = useMemo(() => datesWithPages(pages), [pages]);
  const today = dateKey();
  const start = fromKey(selected ?? today);
  const [ym, setYm] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const weeks = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  const step = (by: number) => setYm(({ y, m }) => {
    const d = new Date(y, m + by, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  return (
    <div className="cal">
      <div className="cal-head">
        <button className="icon-btn" aria-label="Previous month" onClick={() => step(-1)}>
          <span style={{ display: 'inline-flex', transform: 'rotate(90deg)' }}><Icon name="chevron" size={16} /></span>
        </button>
        <strong aria-live="polite">{monthTitle(ym.y, ym.m)}</strong>
        <button className="icon-btn" aria-label="Next month" onClick={() => step(1)}>
          <span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}><Icon name="chevron" size={16} /></span>
        </button>
      </div>
      <div className="cal-grid" role="grid">
        {WEEK_HEADS.map((w) => (
          <span key={w} className="cal-wd" role="columnheader">
            {w}
          </span>
        ))}
        {weeks.flat().map((c) => (
          <button
            key={c.key}
            role="gridcell"
            className={'cal-day' + (c.inMonth ? '' : ' out') + (c.key === today ? ' today' : '') + (c.key === selected ? ' sel' : '') + (have.has(c.key) ? ' has' : '')}
            aria-label={`${c.key}${have.has(c.key) ? ', has a page' : ''}`}
            aria-current={c.key === today ? 'date' : undefined}
            onClick={() => onPick(c.key)}
          >
            {c.day}
          </button>
        ))}
      </div>
      <div className="cal-foot">
        <span><i className="cal-dot" /> has a page</span>
        <button className="btn" onClick={() => onPick(today)}>
          Today
        </button>
      </div>
    </div>
  );
}
