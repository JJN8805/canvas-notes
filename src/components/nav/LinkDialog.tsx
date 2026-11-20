import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoxLink } from '../../types';
import { boxLabel, linkableBoxes, linksOf, linkTargets, pageLabel, resolveLink } from '../../lib/boxLinks';
import { isCard } from '../../lib/pages';
import { addBoxLink, closeLinkDialog, followLink, removeBoxLink, replaceBoxLink, useLinkDialog } from '../../store/boxLinks';
import { useNotes } from '../../store/notes';
import { useOthers } from '../../store/others';
import { stubsByWorkspace } from '../../lib/workspaces';
import { confirmsOnEnter, enterKey } from '../../lib/enterConfirm';
import { Icon } from '../ui/Icon';

/** The links of one box, frame or card: what it leads to now, and a search to add more (a whole page or card, or one box on it). */
export function LinkDialog() {
  const target = useLinkDialog((s) => s.target);
  return target ? <Inner key={target.pageId + target.blockId} pageId={target.pageId} blockId={target.blockId} /> : null;
}

function Inner({ pageId, blockId }: { pageId: string; blockId: string }) {
  const pages = useNotes((s) => s.pages);
  const others = useOthers();
  const block = pages[pageId]?.blocks.find((b) => b.id === blockId);
  const [query, setQuery] = useState('');
  const [replacing, setReplacing] = useState<BoxLink | null>(null); // a missing link being pointed somewhere else
  const [into, setInto] = useState<string | null>(null); // a page chosen to pick one of its boxes
  const searchRef = useRef<HTMLInputElement>(null);
  const prev = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    searchRef.current?.focus();
    const restore = prev.current as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (into) setInto(null);
      else closeLinkDialog();
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      restore?.focus?.();
    };
  }, [into]);
  useEffect(() => {
    if (!block) closeLinkDialog(); // the box or page was deleted while the dialog was open
  }, [block]);

  const existing = block ? linksOf(block) : [];
  const results = useMemo(() => linkTargets(pages, query).slice(0, 60), [pages, query]);
  // Pages of the other workspaces that match: a link to the whole page (its boxes are not loaded here).
  const abroad = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...stubsByWorkspace(others.stubs, null)].map(([ws, list]) => ({
      ws,
      list: list.filter((s) => !q || (s.title || 'Untitled').toLowerCase().includes(q)).slice(0, 30),
    })).filter((g) => g.list.length);
  }, [others, query]);
  const intoPage = into ? pages[into] : null;
  const owner = pages[pageId];
  if (!block || !owner) return null;

  const has = (page: string, blk?: string) => existing.some((l) => l.page === page && (l.block ?? undefined) === blk);
  const owned = pageLabel(owner);
  // Choosing a target adds a link, or, when a missing one is being fixed, moves that link to the target.
  const pick = (link: BoxLink) => {
    if (replacing) replaceBoxLink(pageId, blockId, replacing, link);
    else addBoxLink(pageId, blockId, link);
    setReplacing(null);
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && closeLinkDialog()}>
      <div
        className="dialog link-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Links"
        onKeyDown={(e) => {
          if (confirmsOnEnter(enterKey(e))) {
            e.preventDefault();
            closeLinkDialog();
          }
        }}
      >
        <h2>Links</h2>
        <p>From {isCard(owner) ? 'the card' : 'a box on'} “{owned}” ({boxLabel(block)}). A link can lead to a page, a card, or one box or frame on one.</p>
        {existing.length > 0 && (
          <ul className="ld-list" aria-label="Current links">
            {existing.map((l) => {
              const r = resolveLink(l, pages, others);
              return (
                <li key={l.page + (l.block ?? '')} className={r.broken ? 'broken' : ''}>
                  <Icon name="link" size={14} />
                  <button className="ld-name" disabled={!!r.broken && r.broken === 'page'} onClick={() => followLink(l)} title="Open">
                    {r.label}
                  </button>
                  {r.broken && <span className="ld-chip">missing</span>}
                  {r.broken && (
                    <button className="btn small" aria-label={`Point the link to ${r.label} somewhere else`} onClick={() => { setReplacing(l); setInto(null); setQuery(''); searchRef.current?.focus(); }}>
                      Change…
                    </button>
                  )}
                  <button className="btn small" aria-label={`Remove link to ${r.label}`} onClick={() => removeBoxLink(pageId, blockId, l)}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {replacing && (
          <p className="ld-replacing" role="status">
            Choose where this link should lead instead. <button className="btn small" onClick={() => setReplacing(null)}>Cancel</button>
          </p>
        )}
        {intoPage ? (
          <>
            <h3 className="ld-sub">
              <button className="btn small" onClick={() => setInto(null)}>‹ Back</button> Boxes on “{pageLabel(intoPage)}”
            </h3>
            <ul className="ld-list" aria-label="Boxes to link to">
              <li>
                <button className="ld-name" disabled={has(intoPage.id)} onClick={() => pick({ page: intoPage.id })}>
                  The whole {isCard(intoPage) ? 'card' : 'page'}{has(intoPage.id) ? ' (linked)' : ''}
                </button>
              </li>
              {linkableBoxes(intoPage)
                .filter((b) => !(intoPage.id === pageId && b.id === blockId))
                .map((b) => (
                  <li key={b.id}>
                    <button className="ld-name" disabled={has(intoPage.id, b.id)} onClick={() => pick({ page: intoPage.id, block: b.id })}>
                      {boxLabel(b)}{has(intoPage.id, b.id) ? ' (linked)' : ''}
                    </button>
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <>
            <input
              ref={searchRef}
              className="field"
              type="search"
              placeholder="Search pages and cards to link to"
              aria-label="Search pages and cards"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter in the search links the best match; with nothing typed it is Done.
                const first = results.find((p) => !has(p.id));
                if (e.key === 'Enter' && query.trim() && first && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.stopPropagation();
                  pick({ page: first.id });
                  setQuery('');
                }
              }}
            />
            <ul className="ld-list" aria-label="Pages and cards">
              {results.length === 0 && abroad.length === 0 && <li className="ld-empty">Nothing matches.</li>}
              {results.map((p) => (
                <li key={p.id}>
                  <button className="ld-name" disabled={has(p.id)} onClick={() => pick({ page: p.id })} title="Link to the whole page">
                    {pageLabel(p)}{has(p.id) ? ' (linked)' : ''}
                  </button>
                  <span className="ld-chip">{isCard(p) ? 'card' : 'page'}</span>
                  <button className="btn small" onClick={() => setInto(p.id)} aria-label={`Choose a box on ${pageLabel(p)}`}>
                    A box…
                  </button>
                </li>
              ))}
            </ul>
            {abroad.map((g) => (
              <ul key={g.ws} className="ld-list" aria-label={`In ${others.nameOf(g.ws)}`}>
                <li className="ld-empty">In {others.nameOf(g.ws)} (another workspace; opening it switches there)</li>
                {g.list.map((s) => (
                  <li key={s.id}>
                    <button className="ld-name" disabled={has(s.id)} onClick={() => pick({ page: s.id })} title="Link to the whole page">
                      {s.title.trim() || 'Untitled'}{has(s.id) ? ' (linked)' : ''}
                    </button>
                    <span className="ld-chip">{s.kind === 'card' ? 'card' : 'page'}</span>
                  </li>
                ))}
              </ul>
            ))}
          </>
        )}
        <div className="row">
          <button className="btn primary" onClick={closeLinkDialog}>Done</button>
        </div>
      </div>
    </div>
  );
}
