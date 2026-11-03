import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useNotes } from '../../store/notes';
import { blockText, BLOCK_LABEL } from '../../lib/util';
import { tintVars } from '../../lib/colors';
import { widgetIdFor } from '../../lib/widgets';
import { Icon } from '../ui/Icon';
import { BlockBody, type NonFrameBlock } from '../blocks/BlockBody';
import { CanvasCtx } from '../editor/context';
import { soloCtx } from '../editor/soloCtx';
import { Canvas } from '../editor/Canvas';
import { requestOpenPage, setWidgetLayer } from '../../widgets/host';
import { unpinWidget } from '../../widgets';
import { saveWidget } from '../../widgets/registry';
import { getStorage } from '../../store/notes';
import { useWidgetWindow } from './useWidgetWindow';

/** The contents of a desktop widget window: a title strip you can drag, and the box (or page) itself, editable. */
export function WidgetView({ pageId, blockId }: { pageId: string; blockId: string | null }) {
  const id = widgetIdFor(pageId, blockId);
  const page = useNotes((s) => s.pages[pageId]);
  const found = blockId ? page?.blocks.find((b) => b.id === blockId) : undefined;
  const block = found && found.type !== 'frame' ? (found as NonFrameBlock) : undefined;
  const spec = useWidgetWindow(pageId, blockId);
  const [busy, setBusy] = useState(false);
  const bottom = spec?.bottom ?? true;

  const gone = !page || (blockId !== null && !block);
  const title = !page ? 'Deleted' : blockId ? (block ? BLOCK_LABEL[block.type] : 'Missing box') : page.title.trim() || 'Untitled';

  async function toggleLayer() {
    if (!spec || busy) return;
    setBusy(true);
    try {
      await setWidgetLayer(id, !bottom);
      await saveWidget(getStorage(), { ...spec, bottom: !bottom });
    } finally {
      setBusy(false);
    }
  }

  const tint = block ? (tintVars(block) as CSSProperties | undefined) : undefined;

  return (
    <div className="widget" style={tint}>
      <div className="widget-head" data-tauri-drag-region>
        <span className="widget-title" data-tauri-drag-region title={title}>
          {title}
        </span>
        <button
          className="widget-btn"
          aria-label={bottom ? 'Keep on top of other windows' : 'Put behind other windows, on the desktop'}
          title={bottom ? 'On the desktop (click to float above other windows)' : 'Floating above other windows (click to put on the desktop)'}
          aria-pressed={!bottom}
          disabled={!spec || busy}
          onClick={() => void toggleLayer()}
        >
          <Icon name="layer" size={14} />
        </button>
        {!gone && (
          <button className="widget-btn" aria-label="Open in Canvas Notes" title="Open in Canvas Notes" onClick={() => void requestOpenPage(pageId)}>
            <Icon name="export" size={14} />
          </button>
        )}
        <button className="widget-btn" aria-label="Remove from desktop" title="Remove from desktop" onClick={() => void unpinWidget(id)}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="widget-body">
        {gone ? (
          <p className="widget-gone">{page ? 'This box was deleted.' : 'This page was deleted.'} Remove the widget with the × above.</p>
        ) : block ? (
          <CanvasCtx.Provider value={soloCtx(pageId)}>
            <div className={`block b-${block.type}${block.type === 'text' && block.fill ? ' fill' : ''}`} data-id={block.id} aria-label={blockText(block).slice(0, 40)}>
              <BlockBody block={block} />
            </div>
          </CanvasCtx.Provider>
        ) : (
          <div className="ed-body">
            <Canvas pageId={pageId} />
          </div>
        )}
      </div>
    </div>
  );
}
