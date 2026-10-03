import { useRef } from 'react';
import { flushSync } from 'react-dom';
import type { Draft } from 'immer';
import type { ChecklistBlock, CodeBlock, ImageBlock, TableBlock } from '../../types';
import { updateBlock } from '../../store/notes';
import { newId } from '../../lib/util';
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

  return (
    <div className="body" ref={ref}>
      {block.items.map((it, i) => (
        <div key={it.id} className={'ci' + (it.done ? ' done' : '')}>
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
              if (e.key === 'Enter') {
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
      ))}
      <button className="add-item" onClick={() => addAfter(block.items.length - 1)}>
        + Add item
      </button>
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
