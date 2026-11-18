import { Filter } from '../../types';
import { navigate } from '../../lib/route';
import { createExamplePage, setFilter, setQuery } from '../../store/notes';
import { Icon } from '../ui/Icon';
import { openNewPage } from './shared';
import { useFeature } from '../../store/features';
import { MOD_LABEL } from '../../lib/util';
import { COARSE } from '../../lib/touch';

export function EmptyState({ total, filter, query }: { total: number; filter: Filter; query: string }) {
  const canvas = useFeature('canvas');
  if (!total) {
    return (
      <div className="empty">
        <h2>No pages yet</h2>
        <p>{canvas ? 'Create a page, then place text, images, checklists, code and tables anywhere on it.' : 'Start a document or a spreadsheet from Workspace.'}</p>
        <div className="row">
          <button className="btn primary" onClick={openNewPage}><Icon name="plus" size={16} />{canvas ? 'New page' : 'Start something'}</button>
          {canvas && (
            <button
              className="btn"
              onClick={() => {
                const p = createExamplePage();
                navigate({ name: 'page', id: p.id });
              }}
            >
              Open an example page
            </button>
          )}
        </div>
        <ul className="empty-tips" aria-label="Good to know">
          {COARSE ? (
            <>
              <li><kbd>Search</kbd> finds any page, or jumps straight to it</li>
              {canvas && <li><kbd>+</kbd> starts a page; on a page, the buttons at the bottom add text, lists, pictures…</li>}
              {canvas && <li><kbd>Tap</kbd> a box to type in it, <kbd>pinch</kbd> to zoom, <kbd>two fingers</kbd> to slide</li>}
              {canvas && <li><kbd>Long-press</kbd> a box or empty space for more actions</li>}
            </>
          ) : (
            <>
              <li><kbd>{MOD_LABEL}+K</kbd> finds any page, or jumps straight to it</li>
              {canvas && <li><kbd>/</kbd> on a page adds a box where the pointer is: text, list, table, code…</li>}
              {canvas && <li><kbd>Double-click</kbd> empty space to start typing</li>}
              <li><kbd>?</kbd> lists every keyboard shortcut</li>
            </>
          )}
        </ul>
      </div>
    );
  }
  return (
    <div className="empty">
      <h2>{query ? 'No pages match your search' : 'Nothing here yet'}</h2>
      <p>
        {query
          ? 'Try a different word, or clear the search. You can narrow by #tag, has:image, in:group, after:date and before:date.'
          : filter.kind === 'group'
            ? 'Create a page here, or drag a page card onto this group on the Groups page.'
            : canvas ? 'Create a page to get started.' : 'Start a document or a spreadsheet from Workspace.'}
      </p>
      <div className="row">
        <button className="btn primary" onClick={openNewPage}><Icon name="plus" size={16} />{canvas ? 'New page' : 'Start something'}</button>
        {(query || filter.kind !== 'all') && (
          <button
            className="btn"
            onClick={() => {
              setQuery('');
              setFilter({ kind: 'all' });
            }}
          >
            Show all pages
          </button>
        )}
      </div>
    </div>
  );
}

