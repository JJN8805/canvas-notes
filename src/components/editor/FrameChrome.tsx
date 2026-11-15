import type { CSSProperties } from 'react';
import { ResizeHandles } from './ResizeHandles';
import type { FrameBlock, GroupColor, NoteColor } from '../../types';
import { colorOf, frameInk, noteVar } from '../../lib/colors';
import { duplicateBlocks, setColor, updateBlock } from '../../store/notes';
import { setSelected } from '../../store/canvas';
import { openMenu } from '../../store/ui';
import { blockHeight, colorVar } from '../../lib/util';
import { useFeature } from '../../store/features';
import { LinkBadge } from './LinkBadge';
import { openLinkDialog } from '../../store/boxLinks';
import { Icon } from '../ui/Icon';
import { useCanvasCtx } from './context';
import { layerMenu } from './layerMenu';
import { deleteWithUndo } from './actions';

export function FrameChrome({
  block,
  selected,
  single,
}: {
  block: FrameBlock;
  selected: boolean;
  /** True when this is the only selected block (shows the resize handle). */
  single: boolean;
}) {
  const ctx = useCanvasCtx();
  const { pageId, startMove, startResize } = ctx;
  const linksOn = useFeature('links');

  const style: CSSProperties = {
    left: block.x,
    top: block.y,
    width: block.w,
    height: blockHeight(block),
  };

  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  return (
    <div
      className={`block b-frame${selected ? ' sel' : ''}${block.collapsed ? ' collapsed' : ''}${block.locked ? ' locked' : ''}`}
      data-id={block.id}
      style={style}
      onPointerDownCapture={(e) => ctx.pointerDownBlock(e, block.id)}
    >
      <LinkBadge block={block} pageId={pageId} />
      {block.locked && (
        <span className="lock-badge" role="img" aria-label="Locked" title="Locked: it can’t be moved or deleted. Right-click to unlock.">
          <Icon name="lock" size={11} />
        </span>
      )}
      {!block.collapsed && (
        <div
          className="frame-body"
          style={{ background: block.slide ? (block.slide.bg ? `color-mix(in srgb, ${noteVar(block.slide.bg)} 60%, #fff)` : '#fff') : `color-mix(in srgb, ${colorVar(block.color)} 12%, transparent)`, borderColor: colorVar(block.color) }}
        />
      )}
      <div className="frame-head" style={{ background: colorVar(block.color), color: frameInk(block.color) ?? undefined }} onPointerDown={(e) => startMove(e, block.id)}>
        <button
          className="frame-collapse"
          aria-label={block.collapsed ? 'Expand frame' : 'Collapse frame'}
          title={block.collapsed ? 'Expand' : 'Collapse'}
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            updateBlock<FrameBlock>(pageId, block.id, (b) => {
              b.collapsed = !b.collapsed;
            });
          }}
        >
          <Icon name="chevron" size={13} />
        </button>
        <input
          className="frame-title"
          value={block.title}
          placeholder="Frame"
          onPointerDown={stop}
          onChange={(e) =>
            updateBlock<FrameBlock>(pageId, block.id, (b) => {
              b.title = e.target.value;
            }, { history: { key: 'frame-title:' + block.id } })
          }
        />
        <button
          className="frame-color-btn"
          aria-label="Frame colour"
          title="Colour"
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            openMenu(e.currentTarget, [
              { colors: true, current: colorOf(block), pick: (c: NoteColor | null) => setColor(pageId, [block.id], c) },
              {
                swatches: true,
                title: 'Classic colors',
                current: block.color,
                pick: (c: GroupColor) => updateBlock<FrameBlock>(pageId, block.id, (b) => {
                  b.color = c;
                }),
              },
            ]);
          }}
        />
        <button
          aria-label="Layer"
          title="Layer: forward, backward, over the drawing"
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            openMenu(e.currentTarget, layerMenu(pageId, [block.id]));
          }}
        >
          <Icon name="layer" size={13} />
        </button>
        {linksOn && (
          <button aria-label="Links" title="Links" onPointerDown={stop} onClick={(e) => { stop(e); openLinkDialog(pageId, block.id); }}>
            <Icon name="link" size={13} />
          </button>
        )}
        <button
          aria-label="Duplicate frame"
          title="Duplicate"
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            setSelected(duplicateBlocks(pageId, [block.id]));
          }}
        >
          <Icon name="copy" size={13} />
        </button>
        <button
          aria-label="Delete frame"
          title="Delete"
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            deleteWithUndo(pageId, [block.id]);
          }}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      {selected && single && !block.collapsed && (
        <ResizeHandles onStart={(e, dir) => startResize(e, block.id, dir)} />
      )}
    </div>
  );
}
