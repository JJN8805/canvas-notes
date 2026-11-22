import { useEffect, useMemo, useState } from 'react';
import type { NoteColor } from '../../types';
import { SLIDE_LAYOUTS, slideOfBlock, slidesOf } from '../../lib/office/app';
import { noteVar } from '../../lib/colors';
import { canvasApi, setSelected, useCanvas } from '../../store/canvas';
import { addSlide, copySlide, moveSlideBy, removeSlide, setSlide } from '../../store/office';
import { startPresent } from '../../store/present';
import { useNotes } from '../../store/notes';
import { confirmDanger, openMenu } from '../../store/ui';
import { Icon } from '../ui/Icon';
import { usePhone } from '../ui/usePhone';
import { SlideView } from './SlideView';

/** Beside a presentation's canvas: the slides in order (click to go to one), add, move, copy and delete, the speaker notes, and Present. */
export function SlidesPanel({ pageId }: { pageId: string }) {
  const phone = usePhone(); // on a phone the panel is a small bar over the canvas that opens when asked (it took two thirds of the screen)
  const [open, setOpen] = useState(false);
  const blocks = useNotes((s) => s.pages[pageId]?.blocks);
  const selected = useCanvas((s) => s.selected);
  const slides = useMemo(() => slidesOf(blocks ?? []), [blocks]);
  const current = (selected[0] && blocks ? slideOfBlock(blocks, selected[0]) : null) ?? slides[0] ?? null;
  // Opening a presentation shows its first slide whole, not a corner of the canvas behind the tools.
  const firstId = slides[0]?.id;
  useEffect(() => {
    if (!firstId) return;
    const t = window.setTimeout(() => {
      setSelected([firstId]);
      canvasApi.current?.fitSelection();
      setSelected([]);
    }, 150);
    return () => window.clearTimeout(t);
    // only when the page is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);
  if (!blocks) return null;
  const index = current ? slides.findIndex((s) => s.id === current.id) : -1;
  const go = (id: string) => {
    setSelected([id]);
    canvasApi.current?.fitSelection();
  };

  return (
    <aside className={'slides-panel' + (phone ? ' phone' : '') + (phone && open ? ' open' : '')} aria-label="Slides">
      <div className="slides-head">
        <button className="btn primary small" onClick={() => startPresent(pageId, Math.max(0, index))} disabled={!slides.length}>
          Present
        </button>
        <button
          className="btn small"
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { heading: 'New slide' },
              ...SLIDE_LAYOUTS.map((l) => ({ label: `${l.label} — ${l.hint}`, action: () => { const id = addSlide(pageId, l.id); if (id) window.setTimeout(() => go(id), 50); } })),
            ])
          }
        >
          <Icon name="plus" size={14} /> Slide
        </button>
        {phone && (
          <button className="btn small slides-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {index >= 0 ? index + 1 : 0}/{slides.length} {open ? '▴' : '▾'}
          </button>
        )}
      </div>
      {(!phone || open) && (
      <>
      <ol className="slides-list">
        {slides.map((s, i) => (
          <li key={s.id} className={s.id === current?.id ? 'on' : ''}>
            <button className="slide-thumb" onClick={() => go(s.id)} aria-label={`Slide ${i + 1}`} aria-current={s.id === current?.id}>
              <span className="slide-no">{i + 1}</span>
              <SlideView blocks={blocks} slide={s} width={168} />
            </button>
          </li>
        ))}
      </ol>
      {current && (
        <div className="slide-tools">
          <div className="slide-actions">
            <button className="btn small" aria-label="Move slide up" disabled={index <= 0} onClick={() => moveSlideBy(pageId, current.id, -1)}>↑</button>
            <button className="btn small" aria-label="Move slide down" disabled={index >= slides.length - 1} onClick={() => moveSlideBy(pageId, current.id, 1)}>↓</button>
            <button className="btn small" aria-label="Duplicate slide" onClick={() => { const id = copySlide(pageId, current.id); if (id) window.setTimeout(() => go(id), 50); }}><Icon name="copy" size={14} /></button>
            <button
              className="btn small"
              aria-label="Delete slide"
              disabled={slides.length < 2}
              onClick={() => void confirmDanger(`Delete slide ${index + 1}?`, 'The slide and everything on it are removed. You can undo this.', 'Delete slide').then((ok) => ok && removeSlide(pageId, current.id))}
            >
              <Icon name="trash" size={14} />
            </button>
            <button
              className="btn small"
              aria-label="Slide background"
              onClick={(e) => openMenu(e.currentTarget, [{ colors: true, title: 'Background', current: (current.slide?.bg as NoteColor | null | undefined) ?? null, pick: (c: NoteColor | null) => setSlide(pageId, current.id, { bg: c }) }])}
            >
              <span className="swatch-dot" style={{ background: current.slide?.bg ? noteVar(current.slide.bg) : '#fff' }} />
            </button>
          </div>
          <label className="slide-notes">
            Speaker notes
            <textarea
              key={current.id}
              className="field"
              rows={4}
              defaultValue={current.slide?.notes ?? ''}
              placeholder="What you will say on this slide"
              onBlur={(e) => e.target.value !== (current.slide?.notes ?? '') && setSlide(pageId, current.id, { notes: e.target.value })}
            />
          </label>
        </div>
      )}
      </>
      )}
    </aside>
  );
}

