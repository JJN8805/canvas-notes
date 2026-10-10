import { memo, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Block, FrameBlock, TableBlock, TextBlock } from '../../types';
import { deleteBlocks, duplicateBlocks, sendToBack, updateBlock } from '../../store/notes';
import { setSelected } from '../../store/canvas';
import { BLOCK_LABEL, newId } from '../../lib/util';
import { Icon, type IconName } from '../ui/Icon';
import { TextBody } from '../blocks/TextBody';
import { ChecklistBody, CodeBody, ImageBody, TableBody } from '../blocks/Bodies';
import { useCanvasCtx } from './context';

const LABEL = BLOCK_LABEL;

/** Every block type except frames, which render through FrameChrome instead. */
type NonFrameBlock = Exclude<Block, FrameBlock>;

export const BlockFrame = memo(function BlockFrame({
  block,
  selected,
  single,
}: {
  block: NonFrameBlock;
  selected: boolean;
  /** True when this is the only selected block (shows the resize handle). */
  single: boolean;
}) {
  const ctx = useCanvasCtx();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => ctx.reportHeight(block.id, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [block.id, ctx]);

  const style: CSSProperties = {
    left: block.x,
    top: block.y,
    width: block.w,
    ...(block.type === 'image' ? { height: block.h } : { minHeight: block.h }),
  };

  const cls = ['block', `b-${block.type}`];
  if (selected) cls.push('sel');
  if (block.type === 'text' && block.fill) cls.push('fill');

  return (
    <div ref={ref} className={cls.join(' ')} data-id={block.id} style={style} onPointerDownCapture={(e) => ctx.pointerDownBlock(e, block.id)}>
      <div className="bar-wrap">
        <BlockBar block={block} />
      </div>
      <Body block={block} />
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <div
          key={side}
          className={`dot dot-${side}`}
          aria-hidden="true"
          onPointerDown={(e) => ctx.startConnect(e, block.id, side)}
        />
      ))}
      {selected && single && (
        <div className="resize" aria-hidden="true" title="Drag to resize" onPointerDown={(e) => ctx.startResize(e, block.id)} />
      )}
    </div>
  );
});

function Body({ block }: { block: NonFrameBlock }) {
  switch (block.type) {
    case 'text':
      return <TextBody block={block} />;
    case 'checklist':
      return <ChecklistBody block={block} />;
    case 'code':
      return <CodeBody block={block} />;
    case 'table':
      return <TableBody block={block} />;
    case 'image':
      return <ImageBody block={block} />;
  }
}

function BlockBar({ block }: { block: NonFrameBlock }) {
  const { pageId, startMove } = useCanvasCtx();
  const btn = (label: string, content: ReactNode, run: () => void) => (
    <button
      key={label}
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        run();
      }}
    >
      {content}
    </button>
  );
  const icon = (n: IconName) => <Icon name={n} size={15} />;

  const extra: ReactNode[] = [];
  if (block.type === 'text') {
    extra.push(
      btn(block.fill ? 'Remove background' : 'Add background', 'Fill', () =>
        updateBlock<TextBlock>(pageId, block.id, (b) => {
          b.fill = !b.fill;
        }),
      ),
    );
  }
  if (block.type === 'table') {
    const edit = (fn: (b: TableBlock) => void) => updateBlock<TableBlock>(pageId, block.id, fn);
    extra.push(
      btn('Add row', '+ Row', () => edit((b) => void b.rows.push(b.rows[0].map(() => '')))),
      btn('Add column', '+ Col', () => edit((b) => b.rows.forEach((r, i) => r.push(i ? '' : `Column ${r.length + 1}`)))),
      btn('Remove last row', '− Row', () => edit((b) => void (b.rows.length > 1 && b.rows.pop()))),
      btn('Remove last column', '− Col', () => edit((b) => void (b.rows[0].length > 1 && b.rows.forEach((r) => r.pop())))),
    );
  }
  if (block.type === 'checklist') {
    extra.push(
      btn('Clear completed', 'Clear done', () =>
        updateBlock(pageId, block.id, (b) => {
          if (b.type !== 'checklist') return;
          const left = b.items.filter((i) => !i.done);
          b.items = left.length ? left : [{ id: newId(), text: '', done: false }];
        }),
      ),
    );
  }

  return (
    <div className="bar">
      <span className="grip" role="button" aria-label={`Move ${LABEL[block.type].toLowerCase()} box`} title="Drag to move" onPointerDown={(e) => startMove(e, block.id)}>
        <Icon name="grip" size={14} />
        {LABEL[block.type]}
      </span>
      {extra}
      {btn('Send to back', icon('layer'), () => sendToBack(pageId, [block.id]))}
      {btn('Duplicate', icon('copy'), () => setSelected(duplicateBlocks(pageId, [block.id])))}
      {btn('Delete', icon('trash'), () => {
        deleteBlocks(pageId, [block.id]);
        setSelected([]);
      })}
    </div>
  );
}
