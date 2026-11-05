import { lazy, Suspense, useRef, useState } from 'react';
import { setPageDrawing, useNotes } from '../../store/notes';
import { canvasApi } from '../../store/canvas';
import { confirmDanger } from '../../store/ui';
import { closeDraw, useDraw } from '../../store/draw';
import { usePrefs } from '../../store/prefs';
import { isDarkTheme } from '../../lib/settings';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import type { DrawHandle, DrawView } from '../blocks/DrawEditor';

// Excalidraw is large: it is only fetched the first time draw mode is opened.
const DrawEditor = lazy(() => import('../blocks/DrawEditor'));

const darkQuery = () => isDarkTheme(usePrefs.getState().theme, window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);

/**
 * Draw mode: Excalidraw laid, transparent, over the whole canvas so you draw among the boxes.
 * It cannot work inside the zoomed canvas (it reads pointer positions from the screen), so the two
 * share one view instead. Excalidraw is told where the canvas is, and whenever you pan or zoom
 * inside it the canvas follows (and Excalidraw is pulled back if the canvas can't go that far).
 */
export function DrawOverlay({ pageId }: { pageId: string }) {
  const open = useDraw((s) => s.open);
  if (!open) return null;
  // If drawing can't start (the tools failed to load, or a saved drawing can't be read) say so and let the user leave,
  // instead of the whole window going blank. The page and its boxes are not touched.
  return (
    <ErrorBoundary
      fallback={(error) => (
        <div className="draw-overlay" role="alertdialog" aria-label="Drawing">
          <div className="draw-failed">
            <strong>Drawing couldn’t start</strong>
            <p>Your page and everything on it are safe. {error.message ? `(${error.message.slice(0, 160)})` : ''}</p>
            <div className="row">
              {useNotes.getState().pages[pageId]?.drawing && (
                <button
                  className="btn"
                  onClick={async () => {
                    if (!(await confirmDanger('Erase this page’s drawing?', 'The strokes drawn on this page are deleted so you can draw again. The boxes are not touched.', 'Erase drawing'))) return;
                    setPageDrawing(pageId, null);
                    closeDraw();
                  }}
                >
                  Erase the drawing
                </button>
              )}
              <button className="btn primary" onClick={closeDraw}>Back to the page</button>
            </div>
          </div>
        </div>
      )}
    >
      <Panel pageId={pageId} />
    </ErrorBoundary>
  );
}

const toView = (v: { zoom: number; left: number; top: number }): DrawView => ({ scrollX: -v.left / v.zoom, scrollY: -v.top / v.zoom, zoom: v.zoom });

function Panel({ pageId }: { pageId: string }) {
  // Read once: the saved scene must not be fed back in while drawing.
  const [scene] = useState(() => useNotes.getState().pages[pageId]?.drawing?.scene ?? '');
  const [view] = useState(() => {
    const api = canvasApi.current;
    if (!api) throw new Error('The canvas is not ready yet.');
    return toView(api.getView());
  });
  const handle = useRef<DrawHandle | null>(null);

  const recent = useRef<number[]>([]);
  const follow = (v: DrawView) => {
    const api = canvasApi.current;
    if (!api) return;
    // Safety: the canvas and Excalidraw each correct the other. If they ever disagree for good (a view the canvas can't reach),
    // stop after a burst instead of bouncing forever, which would freeze the window.
    const now = performance.now();
    recent.current = recent.current.filter((t) => now - t < 500);
    if (recent.current.push(now) > 40) return;
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
