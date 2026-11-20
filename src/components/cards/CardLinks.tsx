import { incomingLinks, linksOf, pageLabel, resolveLink } from '../../lib/boxLinks';
import { followLink, openLinkDialog } from '../../store/boxLinks';
import { useNotes } from '../../store/notes';
import { useOthers } from '../../store/others';
import { Icon } from '../ui/Icon';

/** In a card: what it links to (kept on its details box) and what links to it. Click one to go there. */
export function CardLinks({ cardId, bodyId }: { cardId: string; bodyId: string }) {
  const pages = useNotes((s) => s.pages);
  const others = useOthers();
  const body = pages[cardId]?.blocks.find((b) => b.id === bodyId);
  const out = body ? linksOf(body) : [];
  const into = incomingLinks(cardId, pages);
  return (
    <div className="cd-links">
      <span className="cd-links-title"><Icon name="link" size={14} /> Links</span>
      {out.map((l) => {
        const r = resolveLink(l, pages, others);
        return (
          <button key={l.page + (l.block ?? '')} className={`cd-link-chip${r.broken ? ' broken' : ''}`} title={r.broken ? 'Missing' : 'Open'} disabled={r.broken === 'page'} onClick={() => followLink(l)}>
            {r.label}
          </button>
        );
      })}
      <button className="btn small" onClick={() => openLinkDialog(cardId, bodyId)}>{out.length ? 'Edit links' : 'Add a link'}</button>
      {into.length > 0 && (
        <span className="cd-links-in">
          Linked from{' '}
          {Array.from(new Map(into.map((x) => [x.page.id, x.page])).values()).map((p) => (
            <button key={p.id} className="cd-link-chip" onClick={() => followLink({ page: p.id })}>{pageLabel(p)}</button>
          ))}
        </span>
      )}
    </div>
  );
}
