import { Fragment, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Draft } from 'immer';
import { dailyTitle } from '../../lib/daily';
import type { ChecklistBlock, CodeBlock, ImageBlock, TableBlock } from '../../types';
import { updateBlock } from '../../store/notes';
import { newId } from '../../lib/util';
import { dropIndex, moveItem } from '../../lib/reorder';
import { useCanvas } from '../../store/canvas';
import { useImageUrl } from '../../lib/useImageUrl';
import { AutoTextarea } from '../ui/AutoTextarea';
import { useCanvasCtx } from '../editor/context';

/** Focus a textarea inside `root`. Call after a flushSync'd update so the element already exists. */
function focusNow(root: HTMLElement | null, selector: string, caret: 'start' | 'end' | number = 'end') {
  const el = root?.querySelector<HTMLTextAreaElement>(selector);
  if (!el) return;
  el.focus();
  const n = caret === 'start' ? 0 : caret === 'end' ? el.value.length : caret;
  el.setSelectionRange(n, n);
}

/* ---------------- Checklist ---------------- */

export function ChecklistBody({ block }: { block: ChecklistBlock }) {
  const { pageId } = useCanvasCtx();
  const ref = useRef<HTMLDivElement>(null);
  const edit = (fn: (b: Draft<ChecklistBlock>) => void, history: 'push' | 'typing' = 'push') =>
    updateBlock<ChecklistBlock>(pageId, block.id, fn, {
      history: history === 'typing' ? { key: 'list:' + block.id } : 'push',
    });

  const addAfter = (index: number, text = '') => {
    const id = newId();
    flushSync(() =>
      edit((b) => {
        b.items.splice(index + 1, 0, { id, text, done: false });
      }),
    );
    focusNow(ref.current, `[data-item="${id}"]`, 'start');
  };

  // The item being dragged by its handle: how far it has moved, and the place it would land.
  const [drag, setDrag] = useState<{ id: string; dy: number; to: number } | null>(null);

  const startDrag = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const from = block.items.findIndex((x) => x.id === id);
    const rows = Array.from(ref.current?.querySelectorAll<HTMLElement>('.ci') ?? []);
    if (from < 0 || rows.length !== block.items.length) return;
    const mids = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    const y0 = e.clientY;
    const zoom = useCanvas.getState().zoom;
    let to = from;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      to = dropIndex(mids, from, mids[from] + ev.clientY - y0);
      setDrag({ id, dy: (ev.clientY - y0) / zoom, to });
    };
    const end = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      setDrag(null);
      if (ev.type === 'pointerup' && to !== from) edit((b) => void (b.items = moveItem(b.items, from, to)));
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  const others = drag ? block.items.filter((x) => x.id !== drag.id) : [];
  const dropBefore = drag && drag.to !== block.items.findIndex((x) => x.id === drag.id) ? others[drag.to]?.id ?? null : null;
  const dropAtEnd = !!drag && drag.to !== block.items.findIndex((x) => x.id === drag.id) && drag.to >= others.length;

  return (
    <div className="body" ref={ref}>
      {block.items.map((it, i) => (
        <Fragment key={it.id}>
        {dropBefore === it.id && <div className="ci-drop" />}
        <div
          className={'ci' + (it.done ? ' done' : '') + (drag?.id === it.id ? ' lifted' : '')}
          style={drag?.id === it.id ? { transform: `translateY(${drag.dy}px)` } : undefined}
        >
          <span
            className="ci-grip"
            role="button"
            aria-label="Drag to reorder (or Alt + Up / Down in the item)"
            title="Drag to reorder"
            onPointerDown={(e) => startDrag(e, it.id)}
          >
            ⠿
          </span>
          <input
            type="checkbox"
            checked={it.done}
            aria-label="Done"
            onChange={(e) =>
              edit((b) => {
                const item = b.items.find((x) => x.id === it.id);
                if (item) item.done = e.target.checked;
              })
            }
          />
          <AutoTextarea
            className="t"
            data-item={it.id}
            value={it.text}
            placeholder="List item"
            aria-label="List item"
            onValue={(v) =>
              edit((b) => {
                const item = b.items.find((x) => x.id === it.id);
                if (item) item.text = v.replace(/\n/g, ' ');
              }, 'typing')
            }
            onKeyDown={(e) => {
              const ta = e.currentTarget;
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                // Alt + Up / Down moves the item, keeping the cursor in it.
                e.preventDefault();
                const to = i + (e.key === 'ArrowUp' ? -1 : 1);
                if (to < 0 || to >= block.items.length) return;
                const caret = ta.selectionStart;
                flushSync(() => edit((b) => void (b.items = moveItem(b.items, i, to))));
                focusNow(ref.current, `[data-item="${it.id}"]`, caret);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const before = ta.value.slice(0, ta.selectionStart);
                const after = ta.value.slice(ta.selectionEnd);
                const id = newId();
                flushSync(() =>
                  edit((b) => {
                    const idx = b.items.findIndex((x) => x.id === it.id);
                    if (idx < 0) return;
                    b.items[idx].text = before;
                    b.items.splice(idx + 1, 0, { id, text: after, done: false });
                  }),
                );
                focusNow(ref.current, `[data-item="${id}"]`, 'start');
              } else if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0 && i > 0) {
                e.preventDefault();
                const prev = block.items[i - 1];
                const caret = prev.text.length;
                flushSync(() =>
                  edit((b) => {
                    const p = b.items.find((x) => x.id === prev.id);
                    if (p) p.text += it.text;
                    b.items = b.items.filter((x) => x.id !== it.id);
                  }),
                );
                focusNow(ref.current, `[data-item="${prev.id}"]`, caret);
              } else if (e.key === 'ArrowUp' && i > 0 && ta.selectionStart === 0) {
                e.preventDefault();
                focusNow(ref.current, `[data-item="${block.items[i - 1].id}"]`);
              } else if (e.key === 'ArrowDown' && i < block.items.length - 1 && ta.selectionEnd === ta.value.length) {
                e.preventDefault();
                focusNow(ref.current, `[data-item="${block.items[i + 1].id}"]`, 'start');
              }
            }}
          />
        </div>
        </Fragment>
      ))}
      {dropAtEnd && <div className="ci-drop" />}
      <button className="add-item" onClick={() => addAfter(block.items.length - 1)}>
        + Add item
      </button>
      {block.track && (
        <div className="track-note" title="Checks are saved for each day and cleared when a new day starts">
          Tracked daily since {dailyTitle(block.track.start)}
        </div>
      )}
    </div>
  );
}

/* ---------------- Code ---------------- */

export function CodeBody({ block }: { block: CodeBlock }) {
  const { pageId } = useCanvasCtx();
  const set = (v: string) =>
    updateBlock<CodeBlock>(pageId, block.id, (b) => {
      b.code = v;
    }, { history: { key: 'code:' + block.id } });
  return (
    <div className="body">
      <AutoTextarea
        value={block.code}
        onValue={set}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="Paste or type code"
        aria-label="Code"
        onKeyDown={(e) => {
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            const ta = e.currentTarget;
            ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
            set(ta.value);
          }
        }}
      />
    </div>
  );
}

/* ---------------- Table ---------------- */

export function TableBody({ block }: { block: TableBlock }) {
  const { pageId } = useCanvasCtx();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="body" ref={ref}>
      <table>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>
                  <AutoTextarea
                    value={cell}
                    data-cell={`${r}-${c}`}
                    aria-label={`Row ${r + 1}, column ${c + 1}`}
                    onValue={(v) =>
                      updateBlock<TableBlock>(pageId, block.id, (b) => {
                        if (b.rows[r]) b.rows[r][c] = v;
                      }, { history: { key: 'table:' + block.id } })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        focusNow(ref.current, `[data-cell="${r + 1}-${c}"]`);
                      }
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Image ---------------- */

export function ImageBody({ block }: { block: ImageBlock }) {
  const { startMove } = useCanvasCtx();
  const url = useImageUrl(block.imageId);
  return (
    <div className="body" onPointerDown={(e) => startMove(e, block.id)}>
      {url ? (
        <img src={url} alt={block.alt ?? ''} draggable={false} />
      ) : (
        <div className="missing">{url === null ? 'Image not found' : ''}</div>
      )}
    </div>
  );
}
