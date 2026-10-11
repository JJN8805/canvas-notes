import { useMemo } from 'react';
import type { DrawBlock } from '../../types';
import { openDraw } from '../../store/draw';
import { useCanvasCtx } from '../editor/context';

/** An SVG string as an image source. Shown through <img>, so scripts inside it can never run. */
export const svgSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function DrawPreview({ preview }: { preview: string }) {
  const src = useMemo(() => (preview ? svgSrc(preview) : ''), [preview]);
  return (
    <div className="body">
      {src ? <img src={src} alt="Drawing" draggable={false} /> : <div className="missing">Double-click to draw</div>}
    </div>
  );
}

/** A static preview; double-click (or Edit in the box's bar) opens Excalidraw over it. */
export function DrawBody({ block }: { block: DrawBlock }) {
  const { pageId } = useCanvasCtx();
  return (
    <div className="draw-body" onDoubleClick={() => openDraw(pageId, block.id)}>
      <DrawPreview preview={block.preview} />
    </div>
  );
}
