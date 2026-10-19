import { lazy, Suspense, useRef, useState } from 'react';
import { setPageDrawing, useNotes } from '../../store/notes';
import { canvasApi } from '../../store/canvas';
import { closeDraw, useDraw } from '../../store/draw';
import type { DrawHandle, DrawView } from '../blocks/DrawEditor';

// Excalidraw is large: it is only fetched the first time draw mode is opened.
const DrawEditor = lazy(() => import('../blocks/DrawEditor'));

const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/**
 * Draw mode: Excalidraw laid, transparent, over the whole canvas so you draw among the boxes.
 * It cannot work inside the zoomed canvas (it reads pointer positions from the screen), so the two
 * share one view instead. Excalidraw is told where the canvas is, and whenever you pan or zoom
 * inside it the canvas follows (and Excalidraw is pulled back if the canvas can't go that far).
 */
export function DrawOverlay({ pageId }: { pageId: string }) {
  const open = useDraw((s) => s.open);
  if (!open) return null;
  return <Panel pageId={pageId} />;
}

const toView = (v: { zoom: number; left: number; top: number }): DrawView => ({ scrollX: -v.left / v.zoom, scrollY: -v.top / v.zoom, zoom: v.zoom });

function Panel({ pageId }: { pageId: string }) {
  // Read once: the saved scene must not be fed back in while drawing.
  const [scene] = useState(() => useNotes.getState().pages[pageId]?.drawing?.scene ?? '');
  const [view] = useState(() => toView(canvasApi.current!.getView()));
  const handle = useRef<DrawHandle | null>(null);

  const follow = (v: DrawView) => {
    const api = canvasApi.current;
    if (!api) return;
    const cur = api.getView();
    if (Math.abs(cur.zoom - v.zoom) > 1e-6 || Math.abs(-cur.left / cur.zoom - v.scrollX) > 0.5 || Math.abs(-cur.top / cur.zoom - v.scrollY) > 0.5) {
      api.setView({ zoom: v.zoom, left: -v.scrollX * v.zoom, top: -v.scrollY * v.zoom });
      // Once the canvas has settled, pull Excalidraw back to wherever the canvas actually ended up.
      requestAnimationFrame(() => {
        const now = canvasApi.current?.getView();
        if (now) handle.current?.setView(toView(now));
      });
    }
  };

  return (
    <div className="draw-overlay" role="dialog" aria-label="Drawing" onKeyDown={(e) => e.stopPropagation()}>
      <button className="btn primary draw-done" onClick={closeDraw}>
        Done
      </button>
      <Suspense fallback={<div className="draw-loading">Loading drawing tools…</div>}>
        <DrawEditor
          scene={scene}
          view={view}
          dark={darkQuery()}
          onReady={(h) => (handle.current = h)}
          onView={follow}
          onChange={(d) => setPageDrawing(pageId, d)}
        />
      </Suspense>
    </div>
  );
}
