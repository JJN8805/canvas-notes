import type { CSSProperties } from 'react';
import { ResizeHandles } from './ResizeHandles';
import type { FrameBlock, GroupColor, NoteColor } from '../../types';
import { colorOf, frameInk } from '../../lib/colors';
import { deleteBlocks, duplicateBlocks, setColor, updateBlock } from '../../store/notes';
import { setSelected } from '../../store/canvas';
import { openMenu } from '../../store/ui';
import { blockHeight, colorVar } from '../../lib/util';
import { Icon } from '../ui/Icon';
import { useCanvasCtx } from './context';

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

  const style: CSSProperties = {
    left: block.x,
    top: block.y,
    width: block.w,
    height: blockHeight(block),
  };

  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  return (
    <div
      className={`block b-frame${selected ? ' sel' : ''}${block.collapsed ? ' collapsed' : ''}`}
      data-id={block.id}
      style={style}
      onPointerDownCapture={(e) => ctx.pointerDownBlock(e, block.id)}
    >
      {!block.collapsed && (
        <div
          className="frame-body"
          style={{ background: `color-mix(in srgb, ${colorVar(block.color)} 12%, transparent)`, borderColor: colorVar(block.color) }}
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
            deleteBlocks(pageId, [block.id]);
            setSelected([]);
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
