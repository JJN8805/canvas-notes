import { useEffect, useMemo, useRef, useState } from 'react';
import { closeNav, useNav } from '../../store/nav';
import { useNotes } from '../../store/notes';
import { fuzzyFilter } from '../../lib/fuzzy';
import { libraryPages } from '../../lib/pages';
import { navigate } from '../../lib/route';
import { buildCommands } from './commands';

interface Row {
  key: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** The command palette (Ctrl+P) and the quick switcher (Ctrl+O): type to filter, Up/Down to choose, Enter to run. */
export function Palette() {
  const mode = useNav((s) => s.open);
  return mode === 'commands' || mode === 'switcher' ? <PaletteBody mode={mode} /> : null;
}

function PaletteBody({ mode }: { mode: 'commands' | 'switcher' }) {
  const pages = useNotes((s) => s.pages);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const prevFocus = useRef<Element | null>(document.activeElement);

  const rows = useMemo<Row[]>(() => {
    if (mode === 'commands') {
      const all = buildCommands().map((c) => ({ key: c.id, label: c.title, hint: c.keys, run: c.run }));
      return fuzzyFilter(all, query, (r) => r.label);
    }
    const all = libraryPages(pages)
      .sort((a, b) => b.updated - a.updated)
      .map((p) => ({ key: p.id, label: p.title || 'Untitled', hint: p.tags.map((t) => '#' + t).join(' '), run: () => navigate({ name: 'page', id: p.id }) }));
    return fuzzyFilter(all, query, (r) => r.label).slice(0, 50);
  }, [mode, pages, query]);

  useEffect(() => setSel(0), [query, mode]);
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  function close() {
    closeNav();
    (prevFocus.current as HTMLElement | null)?.focus?.();
  }
  function choose(r: Row | undefined) {
    if (!r) return;
    closeNav();
    r.run();
  }

  return (
    <div className="scrim palette-scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label={mode === 'commands' ? 'Command palette' : 'Quick switcher'}>
        <input
          autoFocus
          className="field"
          value={query}
          placeholder={mode === 'commands' ? 'Type a command…' : 'Find or open a page…'}
          aria-label={mode === 'commands' ? 'Command' : 'Page'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, rows.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(rows[sel]);
            }
          }}
        />
        <ul className="palette-list" ref={listRef} role="listbox">
          {rows.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === sel} className={'palette-row' + (i === sel ? ' on' : '')} onMouseMove={() => setSel(i)} onClick={() => choose(r)}>
              <span className="palette-label">{r.label}</span>
              {r.hint && <span className="palette-hint">{r.hint}</span>}
            </li>
          ))}
          {rows.length === 0 && <li className="palette-empty">{mode === 'commands' ? 'No matching command' : 'No matching page'}</li>}
        </ul>
      </div>
    </div>
  );
}
