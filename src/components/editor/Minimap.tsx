import { useEffect, useReducer, useRef } from 'react';
import { useCanvas } from '../../store/canvas';
import { mapToCanvas, minimapLayout, worthShowing, type Box } from '../../lib/minimap';

/**
 * A small picture of the whole page with the part you are looking at outlined. Click or drag on it to go there.
 * Shown only when part of the page is out of view; the Zoom menu or the right-click menu turns it off.
 */
export function Minimap({ boxes, viewRect, goTo, scroller }: { boxes: Box[]; viewRect: () => Box | null; goTo: (cx: number, cy: number) => void; scroller: HTMLElement | null }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const zoom = useCanvas((s) => s.zoom);
  const drag = useRef(false);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scroller) return;
    let raf = 0;
    const tick = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), bump()));
    };
    scroller.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', tick);
    return () => {
      scroller.removeEventListener('scroll', tick);
      window.removeEventListener('resize', tick);
      cancelAnimationFrame(raf);
    };
  }, [scroller]);

  void zoom; // re-render when zooming: the outlined view changes size
  const view = viewRect();
  if (!view || !worthShowing(boxes, view)) return null;
  const l = minimapLayout(boxes, view);
  if (!l) return null;

  const jump = (e: React.PointerEvent) => {
    const r = el.current!.getBoundingClientRect();
    const p = mapToCanvas(l, e.clientX - r.left, e.clientY - r.top);
    goTo(p.x, p.y);
  };
  return (
    <div
      ref={el}
      className="minimap"
      role="img"
      aria-label="Map of the page. Click to go to a place."
      style={{ width: l.width, height: l.height }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        drag.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        jump(e);
      }}
      onPointerMove={(e) => drag.current && jump(e)}
      onPointerUp={() => (drag.current = false)}
      onPointerCancel={() => (drag.current = false)}
    >
      {l.boxes.map((b, i) => (
        <i key={i} style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />
      ))}
      <b style={{ left: l.view.x, top: l.view.y, width: l.view.w, height: l.view.h }} />
    </div>
  );
}
