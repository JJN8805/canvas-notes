import { useEffect } from 'react';
import { useCanvas, type Point } from '../../../store/canvas';

/** Ctrl/⌘ + wheel (and trackpad pinch) and two-finger pinch zoom the canvas around the pointer. */
export function useViewportZoom(viewportRef: { current: HTMLDivElement | null }, zoomTo: (next: number, anchor?: Point) => void) {
  // Ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer.
  useEffect(() => {
    const v = viewportRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = v.getBoundingClientRect();
      zoomTo(useCanvas.getState().zoom * Math.exp(-e.deltaY * 0.0022), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    v.addEventListener('wheel', onWheel, { passive: false });
    return () => v.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  // Two-finger pinch zooms on phones; one finger keeps scrolling natively.
  useEffect(() => {
    const v = viewportRef.current!;
    let start: { dist: number; zoom: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { dist: dist(e.touches), zoom: useCanvas.getState().zoom };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const r = v.getBoundingClientRect();
      const mid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top,
      };
      zoomTo(start.zoom * (dist(e.touches) / start.dist), mid);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    v.addEventListener('touchstart', onStart, { passive: true });
    v.addEventListener('touchmove', onMove, { passive: false });
    v.addEventListener('touchend', onEnd);
    v.addEventListener('touchcancel', onEnd);
    return () => {
      v.removeEventListener('touchstart', onStart);
      v.removeEventListener('touchmove', onMove);
      v.removeEventListener('touchend', onEnd);
      v.removeEventListener('touchcancel', onEnd);
    };
  }, [zoomTo]);
}
