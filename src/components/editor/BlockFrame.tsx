import { createPortal } from 'react-dom';
import { useTouchDock } from '../../store/touchDock';
import { openCard } from '../../store/cardView';
import { useFeature } from '../../store/features';
import { LinkBadge } from './LinkBadge';
import { openLinkDialog } from '../../store/boxLinks';
import { blockActionsFor, useAddons } from '../../addons/store';
import { memo, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ResizeHandles } from './ResizeHandles';
import { NOTE_STYLES, type NoteBlock, type NoteColor, type NoteStyle, type TableBlock } from '../../types';
import { duplicateBlocks, ensureAttendancePage, setColor, setTracking, updateBlock } from '../../store/notes';
import { layerMenu } from './layerMenu';
import { branchFrom, deleteWithUndo } from './actions';
import { navigate } from '../../lib/route';
import { kindClass, noteStyleLabel } from '../../lib/note';
import { changeNoteStyle } from './noteStyle';
import { canvasApi, setSelected } from '../../store/canvas';
import { BLOCK_LABEL, NOTE_HEAD_H, isFixedHeight, newId } from '../../lib/util';
import { hasHeader, isFolded } from '../../lib/note';
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
  const dock = useTouchDock((s) => s.el); // touch screens: the selected box's bar lives in the strip at the bottom of the page
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
    ...(isFolded(block) ? { height: NOTE_HEAD_H, minHeight: 0 } : {}), // folded to its header
    ...tintVars(block),
  } as CSSProperties;

  const cls = ['block', `b-${kindClass(block)}`];
  if (selected) cls.push('sel');
  if (block.locked) cls.push('locked');
  if (block.type === 'note' && block.style === 'text' && block.fill) cls.push('fill');
  if (isFolded(block)) cls.push('folded');
  if (hasHeader(block)) cls.push('has-head');

  return (
    <div ref={ref} className={cls.join(' ')} data-id={block.id} style={style} onPointerDownCapture={(e) => ctx.pointerDownBlock(e, block.id)}
      onDoubleClick={block.type === 'note' && block.style === 'sticky' ? () => canvasApi.current?.focusBlock(block.id) : undefined}>
      {/* A band just outside and inside the box's edge that moves it, so it can be grabbed without the bar. */}
      <div className="grab" aria-hidden="true" title="Drag to move" onPointerDown={(e) => ctx.startMove(e, block.id)} />
      {dock && selected && single ? createPortal(<div className="bar-wrap"><BlockBar block={block} /></div>, dock) : (
        <div className="bar-wrap">
          <BlockBar block={block} />
        </div>
      )}
      <BlockBody block={block} />
      <LinkBadge block={block} pageId={ctx.pageId} />
      {block.locked && (
        <span className="lock-badge" role="img" aria-label="Locked" title="Locked: it can’t be moved or deleted. Right-click to unlock.">
          <Icon name="lock" size={11} />
        </span>
      )}
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
  const linksOn = useFeature('links');
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
  if (block.type === 'note') {
    extra.push(
      <button
        key="style"
        aria-label="Note style"
        title="Switch between a text box, a sticky note and code"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          openMenu(e.currentTarget, [
            { heading: 'Note style' },
            ...NOTE_STYLES.map((st: NoteStyle) => ({
              label: noteStyleLabel[st],
              check: block.style === st,
              action: () => void changeNoteStyle(pageId, [block.id], st),
            })),
          ]);
        }}
      >
        {noteStyleLabel[block.style]} ▾
      </button>,
    );
    if (block.style === 'sticky') {
      // Tab on a keyboard; a button for a finger: a new sticky beside this one, joined to it by an arrow (a mind map grows from here).
      extra.push(btn('Add a linked note', '+ Linked', () => void branchFrom(pageId, block.id, (id) => canvasApi.current?.focusBlock(id))));
    }
    if ((block.style === 'text' || block.style === 'sticky') && !block.doc) {
      // An optional header row above the text, with a fold arrow (tap it to tuck the box away).
      extra.push(
        btn(hasHeader(block) ? 'Remove the header' : 'Add a header', hasHeader(block) ? 'Header ✓' : 'Header', () => {
          const adding = !hasHeader(block);
          updateBlock<NoteBlock>(pageId, block.id, (b) => {
            if (adding) b.header = '';
            else {
              delete b.header;
              delete b.folded;
            }
          });
          if (adding) requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-id="${CSS.escape(block.id)}"] .note-title`)?.focus());
        }),
      );
    }
    if (block.style === 'text') {
      extra.push(
        btn(block.fill ? 'Remove background' : 'Add background', 'Fill', () =>
          updateBlock<NoteBlock>(pageId, block.id, (b) => {
            b.fill = !b.fill;
          }),
        ),
      );
    }
  }
  if (block.type === 'image' && block.video) {
    // A video on the page plays on hover with a mouse; these work with a finger too (and bring the sound).
    const video = () => document.querySelector<HTMLVideoElement>(`[data-id="${CSS.escape(block.id)}"] video`);
    extra.push(
      btn('Play or pause the video', 'Play / Pause', () => {
        const v = video();
        if (v) void (v.paused ? v.play() : v.pause());
      }),
      btn('Turn the sound on or off', 'Sound', () => {
        const v = video();
        if (v) v.muted = !v.muted;
      }),
    );
  }
  if (block.type === 'card') {
    extra.push(btn('Open card', 'Open', () => openCard(block.cardId)));
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
      <span className="grip" role="button" aria-label={`Move ${(LABEL[block.type] ?? 'box').toLowerCase()} box`} title="Drag to move" onPointerDown={(e) => startMove(e, block.id)}>
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
      <button
        aria-label="Layer"
        title="Layer: forward, backward, over the drawing"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          openMenu(e.currentTarget, layerMenu(pageId, [block.id]));
        }}
      >
        {icon('layer')}
      </button>
      {linksOn && btn('Links', icon('link'), () => openLinkDialog(pageId, block.id))}
      {btn('Duplicate', icon('copy'), () => setSelected(duplicateBlocks(pageId, [block.id])))}
      {btn('Delete', icon('trash'), () => {
        deleteWithUndo(pageId, [block.id]);
      })}
    </div>
  );
}
