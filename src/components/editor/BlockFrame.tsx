import { blockActionsFor, useAddons } from '../../addons/store';
import { memo, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ResizeHandles } from './ResizeHandles';
import type { NoteColor, TableBlock, TextBlock } from '../../types';
import { deleteBlocks, duplicateBlocks, ensureAttendancePage, sendToBack, setColor, setTracking, updateBlock } from '../../store/notes';
import { navigate } from '../../lib/route';
import { canvasApi, setSelected } from '../../store/canvas';
import { BLOCK_LABEL, isFixedHeight, newId } from '../../lib/util';
import { Icon, type IconName } from '../ui/Icon';
import { BlockBody } from '../blocks/BlockBody';
import { colorOf, noteVar, tintVars } from '../../lib/colors';
import { confirmDanger, openMenu, toast } from '../../store/ui';
import { useCanvasCtx } from './context';
import { pinBlock } from '../../widgets';
import { useWidgetsAvailable } from '../../widgets/useWidgetsAvailable';

const LABEL = BLOCK_LABEL;

/** Every block type except frames, which render through FrameChrome instead. */
import type { NonFrameBlock } from '../blocks/BlockBody';

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
    ...(isFixedHeight(block) ? { height: block.h } : { minHeight: block.h }),
    ...tintVars(block),
  } as CSSProperties;

  const cls = ['block', `b-${block.type}`];
  if (selected) cls.push('sel');
  if (block.type === 'text' && block.fill) cls.push('fill');

  return (
    <div ref={ref} className={cls.join(' ')} data-id={block.id} style={style} onPointerDownCapture={(e) => ctx.pointerDownBlock(e, block.id)}
      onDoubleClick={block.type === 'sticky' ? () => canvasApi.current?.focusBlock(block.id) : undefined}>
      {/* A band just outside and inside the box's edge that moves it, so it can be grabbed without the bar. */}
      <div className="grab" aria-hidden="true" title="Drag to move" onPointerDown={(e) => ctx.startMove(e, block.id)} />
      <div className="bar-wrap">
        <BlockBar block={block} />
      </div>
      <BlockBody block={block} />
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <div
          key={side}
          className={`dot dot-${side}`}
          aria-hidden="true"
          onPointerDown={(e) => ctx.startConnect(e, block.id, side)}
        />
      ))}
      {selected && single && (
        <ResizeHandles onStart={(e, dir) => ctx.startResize(e, block.id, dir)} />
      )}
    </div>
  );
});

function BlockBar({ block }: { block: NonFrameBlock }) {
  const { pageId, startMove } = useCanvasCtx();
  const canPin = useWidgetsAvailable();
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
  useAddons((s) => s.loaded); // re-render when an add-on starts or stops, so its buttons appear
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
    // A tracked list keeps its items (their history is kept per item), so it has no "Clear done".
    if (!block.track) {
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
    extra.push(
      btn(block.track ? 'Stop tracking daily' : 'Track daily', block.track ? 'Tracking ✓' : 'Track daily', () => {
        if (!block.track) {
          setTracking(pageId, block.id, true);
          toast('Tracking daily. Your checks are saved each day and cleared at the start of the next. Open Attendance to see them.');
          return;
        }
        void confirmDanger(
          'Stop tracking this list?',
          'Its daily record is forgotten and the checks stay as they are. An attendance page you already made keeps what it shows but stops updating.',
          'Stop tracking',
        ).then((ok) => ok && setTracking(pageId, block.id, false));
      }),
    );
    if (block.track) {
      extra.push(
        btn('Open the attendance page', 'Attendance', () => {
          const id = ensureAttendancePage(pageId, block.id);
          if (id) navigate({ name: 'page', id });
        }),
      );
    }
  }

  return (
    <div className="bar">
      <span className="grip" role="button" aria-label={`Move ${LABEL[block.type].toLowerCase()} box`} title="Drag to move" onPointerDown={(e) => startMove(e, block.id)}>
        <Icon name="grip" size={14} />
        {LABEL[block.type]}
      </span>
      {extra}
      {blockActionsFor(block, pageId).map((a) => btn(a.label, a.label, () => void a.run()))}
      <button
        aria-label="Color"
        title={block.type === 'image' ? 'Border color' : 'Color'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          openMenu(e.currentTarget, [
            { colors: true, title: block.type === 'image' ? 'Border color' : 'Color', current: colorOf(block), pick: (c: NoteColor | null) => setColor(pageId, [block.id], c) },
          ]);
        }}
      >
        <span className="swatch-dot" style={{ background: block.tint ? noteVar(block.tint) : 'transparent' }} />
      </button>
      {canPin && btn('Pin to desktop', icon('pin'), () => void pinBlock(pageId, block))}
      {btn('Send to back', icon('layer'), () => sendToBack(pageId, [block.id]))}
      {btn('Duplicate', icon('copy'), () => setSelected(duplicateBlocks(pageId, [block.id])))}
      {btn('Delete', icon('trash'), () => {
        deleteBlocks(pageId, [block.id]);
        setSelected([]);
      })}
    </div>
  );
}
