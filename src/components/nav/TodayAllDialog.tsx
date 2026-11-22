import { useEffect } from 'react';
import { closeTodayAll, useTodayAll } from '../../store/todayAll';
import { openPageAnywhere } from '../../store/workspaces';
import { colorVar } from '../../lib/util';

/** Today in every workspace at a glance: the day's journal page, what is still to do, and what was touched last. Each line opens its page. */
export function TodayAllDialog() {
  const desks = useTodayAll((s) => s.desks);
  useEffect(() => {
    if (!desks) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), closeTodayAll());
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [desks]);
  if (!desks) return null;
  const open = (id: string) => {
    closeTodayAll();
    void openPageAnywhere(id);
  };
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && closeTodayAll()}>
      <div className="dialog today-all" role="dialog" aria-modal="true" aria-label="Today in every workspace">
        <h2>Today, in every workspace</h2>
        {desks.map((d) => (
          <section key={d.workspace.id || 'main'} className="ta-desk" aria-label={d.workspace.name}>
            <h3>
              <span className="ws-dot" style={{ background: colorVar(d.workspace.color) }} aria-hidden="true" /> {d.workspace.name}
            </h3>
            {d.journal ? (
              <button className="ld-name" onClick={() => open(d.journal!.pageId)}>
                Today’s journal{d.journal.snippet ? `: ${d.journal.snippet}` : ' (empty so far)'}
              </button>
            ) : (
              <p className="ta-none">No journal page for today yet.</p>
            )}
            {d.todoCount > 0 ? (
              <ul className="ld-list" aria-label={`Still to do in ${d.workspace.name}`}>
                {d.todos.map((t, i) => (
                  <li key={t.pageId + i}>
                    <button className="ld-name" onClick={() => open(t.pageId)}>
                      ☐ {t.text}
                    </button>
                    <span className="ld-chip">{t.page}</span>
                  </li>
                ))}
                {d.todoCount > d.todos.length && <li className="ld-empty">and {d.todoCount - d.todos.length} more</li>}
              </ul>
            ) : (
              <p className="ta-none">Nothing left to do.</p>
            )}
            {d.recent.length > 0 && (
              <p className="ta-recent">
                Latest:{' '}
                {d.recent.map((r) => (
                  <button key={r.pageId} className="cd-link-chip" onClick={() => open(r.pageId)}>
                    {r.title}
                  </button>
                ))}
              </p>
            )}
          </section>
        ))}
        <div className="row">
          <button className="btn primary" onClick={closeTodayAll}>Close</button>
        </div>
      </div>
    </div>
  );
}
