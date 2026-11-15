import { useEffect, useMemo, useRef, useState } from 'react';
import { slidesOf } from '../../lib/office/app';
import { goToSlide, stopPresent, usePresent } from '../../store/present';
import { useNotes } from '../../store/notes';
import { SlideView } from './SlideView';

/** The full-screen show: one slide at a time. Arrow keys, Space, PageUp/PageDown and clicks move; N shows the speaker notes; Esc ends it. */
export function PresentMode() {
  const show = usePresent((s) => s.show);
  return show ? <Show key={show.pageId} pageId={show.pageId} index={show.index} /> : null;
}

function Show({ pageId, index }: { pageId: string; index: number }) {
  const blocks = useNotes((s) => s.pages[pageId]?.blocks);
  const slides = useMemo(() => slidesOf(blocks ?? []), [blocks]);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [notes, setNotes] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const at = Math.min(Math.max(index, 0), Math.max(0, slides.length - 1));

  useEffect(() => {
    root.current?.focus();
    const resize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  // The page was deleted, or lost its slides, while the show was running.
  useEffect(() => {
    if (!blocks || !slides.length) stopPresent();
  }, [blocks, slides.length]);

  const next = () => (at < slides.length - 1 ? goToSlide(at + 1) : stopPresent());
  const prev = () => goToSlide(Math.max(0, at - 1));
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === 'Escape') stopPresent();
    else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') next();
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') prev();
    else if (k === 'Home') goToSlide(0);
    else if (k === 'End') goToSlide(slides.length - 1);
    else if (k.toLowerCase() === 'n') setNotes((v) => !v);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const slide = slides[at];
  if (!blocks || !slide) return null;
  const noteH = notes ? 150 : 0;
  const width = Math.min(size.w, ((size.h - noteH) * 16) / 9);
  return (
    <div ref={root} className="present" tabIndex={0} role="dialog" aria-modal="true" aria-label={`Presenting, slide ${at + 1} of ${slides.length}`} onKeyDown={onKey} onClick={next}>
      <SlideView blocks={blocks} slide={slide} width={width} />
      <div className="present-count" aria-hidden="true">{at + 1} / {slides.length}</div>
      {notes && (
        <div className="present-notes" onClick={(e) => e.stopPropagation()}>
          {slide.slide?.notes?.trim() || 'No speaker notes for this slide.'}
        </div>
      )}
      <button className="present-exit" aria-label="End the show" onClick={(e) => { e.stopPropagation(); stopPresent(); }}>✕</button>
    </div>
  );
}
