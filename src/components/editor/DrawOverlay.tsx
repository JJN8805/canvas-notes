import { lazy, Suspense, useEffect, useState } from "react";
import type { DrawBlock } from "../../types";
import { updateBlock, useNotes } from "../../store/notes";
import { closeDraw, useDraw } from "../../store/draw";

// Excalidraw is large: it is only fetched the first time a drawing is opened.
const DrawEditor = lazy(() => import("../blocks/DrawEditor"));

const MIN_W = 560;
const MIN_H = 420;

/**
 * Excalidraw cannot work inside the zoomed canvas (it reads pointer positions from the screen),
 * so it opens in an unscaled panel placed over the box being edited, at least big enough for its toolbar.
 */
export function DrawOverlay({ pageId }: { pageId: string }) {
  const editing = useDraw((s) => s.editing);
  if (!editing || editing.pageId !== pageId) return null;
  return (
    <Panel key={editing.blockId} pageId={pageId} blockId={editing.blockId} />
  );
}

function Panel({ pageId, blockId }: { pageId: string; blockId: string }) {
  const block = useNotes((s) =>
    s.pages[pageId]?.blocks.find((b) => b.id === blockId),
  );
  // Read once: the saved scene must not be fed back in while drawing.
  const [scene] = useState(() => (block?.type === "draw" ? block.scene : ""));
  const [rect] = useState(() => {
    const r = document
      .querySelector<HTMLElement>(`[data-id="${CSS.escape(blockId)}"]`)
      ?.getBoundingClientRect();
    const w = Math.min(Math.max(r?.width ?? 0, MIN_W), window.innerWidth - 16);
    const h = Math.min(
      Math.max(r?.height ?? 0, MIN_H),
      window.innerHeight - 16,
    );
    const cx = (r?.left ?? 0) + (r?.width ?? w) / 2;
    const cy = (r?.top ?? 0) + (r?.height ?? h) / 2;
    return {
      left: Math.min(Math.max(8, cx - w / 2), window.innerWidth - w - 8),
      top: Math.min(Math.max(8, cy - h / 2), window.innerHeight - h - 8),
      width: w,
      height: h,
    };
  });

  useEffect(() => {
    if (!block) closeDraw(); // the box was deleted (for example by undo)
  }, [block]);

  return (
    <div
      className="draw-overlay"
      style={rect}
      role="dialog"
      aria-label="Drawing editor"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button className="btn primary draw-done" onClick={closeDraw}>
        Done
      </button>
      <Suspense
        fallback={<div className="draw-loading">Loading drawing tools…</div>}
      >
        <div className="draw-host">
          <DrawEditor
            scene={scene}
            onChange={(next, preview) =>
              updateBlock<DrawBlock>(
                pageId,
                blockId,
                (b) => {
                  b.scene = next;
                  b.preview = preview;
                },
                { history: { key: "draw:" + blockId } },
              )
            }
          />
        </div>
      </Suspense>
    </div>
  );
}
