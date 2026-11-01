import { useEffect } from 'react';
import { closeNav } from '../../store/nav';
import { useNotes } from '../../store/notes';
import { outgoingLinks, outline } from '../../lib/links';
import { navigate } from '../../lib/route';

/** The headings and frames of the open page, and the pages it links to. Click one to jump there. */
export function OutlinePanel({ pageId }: { pageId: string }) {
  const page = useNotes((s) => s.pages[pageId]);
  const pages = useNotes((s) => s.pages);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeNav();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  if (!page) return null;
  const items = outline(page);
  const links = outgoingLinks(page, pages);

  function jump(blockId: string) {
    closeNav();
    window.setTimeout(() => document.querySelector(`[data-id="${blockId}"]`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }), 0);
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeNav()}>
      <div className="dialog outline" role="dialog" aria-label="Outline and links">
        <h2>Outline</h2>
        {items.length === 0 ? (
          <p>No headings or frame titles on this page yet. Use H1–H3 in a text box, or add a frame.</p>
        ) : (
          <ul className="outline-list">
            {items.map((o, i) => (
              <li key={o.blockId + i} style={{ paddingLeft: (o.level - 1) * 14 }}>
                <button className="outline-item" onClick={() => jump(o.blockId)}>
                  {o.kind === 'frame' ? '▢ ' : ''}
                  {o.text}
                </button>
              </li>
            ))}
          </ul>
        )}
        <h3>Links from this page</h3>
        {links.length === 0 ? (
          <p>Type <code>[[Page title]]</code> in a text box to link to another page.</p>
        ) : (
          <ul className="outline-list">
            {links.map((l) => (
              <li key={l.title}>
                {l.page ? (
                  <button
                    className="outline-item"
                    onClick={() => {
                      closeNav();
                      navigate({ name: 'page', id: l.page!.id });
                    }}
                  >
                    {l.page.title || 'Untitled'}
                  </button>
                ) : (
                  <span className="outline-missing">{l.title} (no such page)</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={closeNav}>Close</button>
        </div>
      </div>
    </div>
  );
}
