import { useMemo } from 'react';
import { timeAgo } from '../../lib/util';
import { archivedPages } from '../../lib/pages';
import { restorePage } from '../../store/archive';
import { deletePage, useNotes } from '../../store/notes';
import { confirmDanger } from '../../store/ui';
import { navigate } from '../../lib/route';
import { openCard } from '../../store/cardView';
import { Thumbnail } from './Thumbnail';

/* ---------------- Archive ---------------- */

/** Pages and cards put away: kept (with their pictures and files, and synced), but out of the library and search. Restore, open or delete them here. */
export function ArchiveView() {
  const pages = useNotes((s) => s.pages);
  const query = useNotes((s) => s.query);
  const all = useMemo(() => archivedPages(pages), [pages]);
  const q = query.trim().toLowerCase();
  const list = q ? all.filter((p) => (p.title || '').toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))) : all;
  return (
    <>
      <div className="main-head">
        <div className="main-title">
          <h1>Archive</h1>
          <p>
            {all.length} archived {all.length === 1 ? 'item' : 'items'}. Kept as they are, with their pictures and files, out of your library and search.
          </p>
        </div>
      </div>
      {list.length ? (
        <div className="cards">
          {list.map((p) => (
            <article key={p.id} className="card archived" aria-label={p.title || 'Untitled'}>
              <Thumbnail blocks={p.blocks} arrows={p.arrows} drawing={p.drawing} sheet={p.sheet} />
              <div className="card-body">
                <div className={'card-title' + (p.title ? '' : ' untitled')}>
                  {p.icon && <span className="page-icon" aria-hidden="true">{p.icon}</span>}
                  {p.title || 'Untitled'}
                </div>
                <div className="card-meta">
                  {p.kind === 'card' ? 'Card · ' : ''}{timeAgo(p.updated)}
                </div>
                <div className="trash-actions">
                  <button className="btn" onClick={() => restorePage(p.id)}>Restore</button>
                  <button className="btn" onClick={() => (p.kind === 'card' ? openCard(p.id) : navigate({ name: 'page', id: p.id }))}>Open</button>
                  <button
                    className="btn"
                    onClick={async () => {
                      const ok = await confirmDanger(`Delete “${p.title || 'Untitled'}”?`, 'It goes to Trash, where you can restore it for a while.', 'Delete');
                      if (ok) await deletePage(p.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>{q ? 'No archived page matches' : 'The Archive is empty'}</h2>
          <p>{q ? 'Try a different word.' : 'Put pages and cards here with Archive, in a page’s menu or its header. They are kept with their pictures and files, but leave your library and search until you restore them.'}</p>
        </div>
      )}
    </>
  );
}
