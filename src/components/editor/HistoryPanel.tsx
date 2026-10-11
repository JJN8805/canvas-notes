import { useEffect, useState } from 'react';
import type { Snapshot } from '../../storage/types';
import { getStorage, restoreSnapshot } from '../../store/notes';
import { Thumbnail } from '../library/Thumbnail';

const fmt = (t: number) => {
  const d = new Date(t);
  const day = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === day.toDateString()) return `Today ${time}`;
  day.setDate(day.getDate() - 1);
  if (d.toDateString() === day.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
};

/** Earlier versions of this page, kept on this device only. */
export function HistoryPanel({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);

  useEffect(() => {
    let live = true;
    getStorage()
      .listSnapshots(pageId)
      .then((l) => live && setSnaps(l))
      .catch(() => live && setSnaps([]));
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => {
      live = false;
      window.removeEventListener('keydown', key);
    };
  }, [pageId, onClose]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog history" role="dialog" aria-label="Page history">
        <h2>History</h2>
        <p>Earlier versions of this page, kept on this device only: hourly for 2 days, then daily for 30 days.</p>
        {snaps === null ? null : snaps.length === 0 ? (
          <p>No earlier versions yet. They appear as you keep editing this page.</p>
        ) : (
          <ul className="history-list">
            {snaps.map((s) => (
              <li key={s.id} className="history-item">
                <div className="history-thumb">
                  <Thumbnail blocks={s.blocks} arrows={s.arrows} />
                </div>
                <div className="history-info">
                  <div className="card-title">{fmt(s.taken)}</div>
                  <div className="card-meta">
                    {s.blocks.length} box{s.blocks.length === 1 ? '' : 'es'}
                    {s.title ? ` · ${s.title}` : ''}
                  </div>
                  <button
                    className="btn"
                    onClick={async () => {
                      await restoreSnapshot(pageId, s);
                      onClose();
                    }}
                  >
                    Restore this version
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
