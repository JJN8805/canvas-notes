import { COARSE } from '../../lib/touch';
import { confirmsOnEnter, enterKey } from '../../lib/enterConfirm';
import { useEffect, useMemo, useRef } from 'react';
import { applyTidy, useNotes } from '../../store/notes';
import { closeTidy, useTidy } from '../../store/tidy';
import { toast } from '../../store/ui';
import { tidied, tidyPage } from '../../lib/tidy';
import { Thumbnail } from '../library/Thumbnail';

/**
 * "Tidy this page": shows the page now and as it would be after lining up edges and separating overlaps, says what would change, and
 * only changes the page when the user presses Apply (one undo step). Nothing here is sent anywhere.
 */
export function TidyDialog() {
  const pageId = useTidy((s) => s.pageId);
  const page = useNotes((s) => (pageId ? s.pages[pageId] : undefined));
  const result = useMemo(() => (page ? tidyPage(page) : null), [page]);
  // The proposal is worked out when the dialog opens and kept: it must not change under the user's eyes (and Apply checks the page still matches it).
  const frozen = useRef<{ id: string; result: NonNullable<typeof result> } | null>(null);
  if (pageId && result && frozen.current?.id !== pageId) frozen.current = { id: pageId, result };
  if (!pageId) frozen.current = null;
  const apply = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pageId) apply.current?.focus();
  }, [pageId, result?.changed]);
  if (!pageId || !page || !frozen.current) return null;
  const r = frozen.current.result;
  const after = tidied(page.blocks, r);
  const stale = frozen.current.result.basis !== tidyPage(page).basis;
  const doApply = () => {
    const out = applyTidy(pageId, r);
    closeTidy();
    if (out === 'applied') toast(COARSE ? 'Tidied the page. Undo with the arrow at the top.' : 'Tidied the page. Undo with Ctrl+Z.');
    else if (out === 'stale') toast('The page changed while this was open. Nothing was changed.');
  };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeTidy()}>
      <div className="dialog tidy" role="dialog" aria-modal="true" aria-label="Tidy this page" onKeyDown={(e) => {
        if (e.key === 'Escape') return void (e.stopPropagation(), closeTidy());
        if (r.changed && !stale && confirmsOnEnter(enterKey(e))) (e.preventDefault(), doApply());
      }}>
        <h2>Tidy this page</h2>
        {r.changed ? (
          <>
            <p>Nothing changes until you press Apply, and you can undo it afterwards.</p>
            <div className="tidy-pair">
              <figure>
                <Thumbnail blocks={page.blocks} arrows={page.arrows} drawing={page.drawing} sheet={page.sheet} />
                <figcaption>Now</figcaption>
              </figure>
              <figure>
                <Thumbnail blocks={after} arrows={page.arrows} drawing={page.drawing} sheet={r.sheet ?? page.sheet} />
                <figcaption>After tidying</figcaption>
              </figure>
            </div>
            <ul className="tidy-notes">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            {stale && <p className="tidy-stale" role="alert">The page has changed since this was worked out. Close this and open it again.</p>}
          </>
        ) : (
          <p>This page is already tidy: nothing overlaps and nearby edges already line up.</p>
        )}
        <div className="row">
          <button className="btn" onClick={closeTidy}>{r.changed ? 'Cancel' : 'Close'}</button>
          {r.changed && <button ref={apply} className="btn primary" disabled={stale} onClick={doApply}>Apply</button>}
        </div>
      </div>
    </div>
  );
}
