import { useEffect } from 'react';
import { timeAgo } from '../../lib/util';
import { usePrefs } from '../../store/prefs';
import { daysLeft } from '../../lib/history';
import { deleteForever, loadTrash, restoreFromTrash, useNotes } from '../../store/notes';
import { confirmDanger } from '../../store/ui';
import { Thumbnail } from './Thumbnail';

/* ---------------- Trash ---------------- */

export function TrashView() {
  const trash = useNotes((s) => s.trash);
  useEffect(() => void loadTrash(), []);
  const now = Date.now();
  const keep = usePrefs((s) => s.trashDays);
  return (
    <>
      <div className="main-head">
        <div className="main-title">
          <h1>Trash</h1>
          <p>
            {trash.length} deleted page{trash.length === 1 ? '' : 's'}. They are removed for good {keep} days after deletion.
          </p>
        </div>
      </div>
      {trash.length ? (
        <div className="cards">
          {trash.map((p) => (
            <article key={p.id} className="card trashed" aria-label={p.title || 'Untitled'}>
              <Thumbnail blocks={p.blocks} arrows={p.arrows} drawing={p.drawing} />
              <div className="card-body">
                <div className={'card-title' + (p.title ? '' : ' untitled')}>{p.title || 'Untitled'}</div>
                <div className="card-meta">
                  Deleted {timeAgo(p.updated)}, removed in {daysLeft(p.updated, now, keep)} day{daysLeft(p.updated, now, keep) === 1 ? '' : 's'}
                </div>
                <div className="trash-actions">
                  <button className="btn" onClick={() => restoreFromTrash(p.id)}>Restore</button>
                  <button
                    className="btn"
                    onClick={async () => {
                      const ok = await confirmDanger(
                        `Delete “${p.title || 'Untitled'}” forever?`,
                        'This page and its saved versions are removed from this device and from your other devices the next time they sync. This cannot be undone.',
                        'Delete forever',
                      );
                      if (ok) await deleteForever(p.id);
                    }}
                  >
                    Delete forever
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>Trash is empty</h2>
          <p>Pages you delete stay here for {keep} days, so you can bring them back.</p>
        </div>
      )}
    </>
  );
}

