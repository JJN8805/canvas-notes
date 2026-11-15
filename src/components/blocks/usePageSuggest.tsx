import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import type { Page } from '../../types';
import { linkText, suggestPages, wikiTrigger } from '../../lib/pageSuggest';
import { useNotes } from '../../store/notes';
import { featureOn } from '../../store/features';

interface Open {
  from: number;
  to: number;
  items: Page[];
  index: number;
  x: number;
  y: number;
}

/**
 * The page picker that opens when `[[` is typed in a note. `track` is called after each change; `onKeyDown` goes in the editor's
 * key handler (Up/Down choose, Enter or Tab insert, Esc closes). Returns the popup to render.
 */
export function usePageSuggest(pageId: string): { popup: ReactNode; track: (ed: Editor) => void; onKeyDown: (view: EditorView, e: KeyboardEvent) => boolean; close: () => void } {
  const [open, setOpen] = useState<Open | null>(null);
  const ref = useRef<Open | null>(null);
  const edRef = useRef<Editor | null>(null);
  const set = (o: Open | null) => {
    ref.current = o;
    setOpen(o);
  };

  const track = (ed: Editor) => {
    edRef.current = ed;
    if (!featureOn('links')) return set(null);
    const { from, empty } = ed.state.selection;
    if (!empty || !ed.isFocused) return set(null);
    const before = ed.state.doc.textBetween(Math.max(0, from - 80), from, '\n', '\0');
    const t = wikiTrigger(before);
    if (!t) return set(null);
    const items = suggestPages(useNotes.getState().pages, t.query, pageId);
    if (!items.length) return set(null);
    const at = ed.view.coordsAtPos(from);
    const keep = ref.current && ref.current.items[ref.current.index] ? Math.min(ref.current.index, items.length - 1) : 0;
    set({ from: from - t.length, to: from, items, index: keep, x: at.left, y: at.bottom + 6 });
  };

  const choose = (page: Page) => {
    const o = ref.current;
    const ed = edRef.current;
    if (!o || !ed) return;
    ed.chain().focus().insertContentAt({ from: o.from, to: o.to }, { type: 'text', text: linkText(page.title) }).run();
    set(null);
  };

  const onKeyDown = (_view: EditorView, e: KeyboardEvent): boolean => {
    const o = ref.current;
    if (!o) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const n = o.items.length;
      set({ ...o, index: (o.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      choose(o.items[o.index]);
      return true;
    }
    if (e.key === 'Escape') {
      set(null);
      return true;
    }
    return false;
  };

  const popup = open
    ? createPortal(
        <ul className="page-suggest" role="listbox" aria-label="Pages to link to" style={{ left: open.x, top: open.y }}>
          {open.items.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === open.index} className={i === open.index ? 'on' : ''}
              onMouseDown={(e) => {
                e.preventDefault(); // keep the cursor in the note
                choose(p);
              }}>
              {p.title}
            </li>
          ))}
        </ul>,
        document.body,
      )
    : null;

  return { popup, track, onKeyDown, close: () => set(null) };
}
