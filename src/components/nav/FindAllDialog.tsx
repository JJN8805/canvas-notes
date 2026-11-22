import { useEffect, useRef } from 'react';
import { closeFindAll, runFindAll, useFindAll } from '../../store/findAll';
import { openPageAnywhere, useWorkspaceList } from '../../store/workspaces';
import { colorVar } from '../../lib/util';

/** Searches the titles and text of every workspace (the quick switcher only sees the open one's text). Each result opens its page. */
export function FindAllDialog() {
  const { query, results, busy } = useFindAll();
  const list = useWorkspaceList();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (query === null) return;
    input.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), closeFindAll());
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [query === null]); // eslint-disable-line react-hooks/exhaustive-deps
  if (query === null) return null;
  const color = (ws: string) => list.find((w) => w.id === ws);
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && closeFindAll()}>
      <div className="dialog link-dialog" role="dialog" aria-modal="true" aria-label="Find in every workspace">
        <h2>Find in every workspace</h2>
        <input
          ref={input}
          className="field"
          type="search"
          placeholder="Words from a title or the text"
          aria-label="Search every workspace"
          value={query}
          onChange={(e) => void runFindAll(e.target.value)}
        />
        <ul className="ld-list" aria-label="Results" aria-live="polite">
          {!query.trim() && <li className="ld-empty">Type to search all your workspaces.</li>}
          {query.trim() && !busy && results.length === 0 && <li className="ld-empty">Nothing matches.</li>}
          {results.map((r) => {
            const w = color(r.workspace);
            return (
              <li key={r.pageId}>
                <button className="ld-name" onClick={() => (closeFindAll(), void openPageAnywhere(r.pageId))}>
                  {r.title}
                  {r.snippet ? <span className="ta-none"> — {r.snippet}</span> : null}
                </button>
                <span className="ld-chip">
                  <span className="ws-dot" style={{ background: w ? colorVar(w.color) : undefined, display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 4 }} aria-hidden="true" />
                  {w?.name ?? ''}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="row">
          <button className="btn primary" onClick={closeFindAll}>Close</button>
        </div>
      </div>
    </div>
  );
}
