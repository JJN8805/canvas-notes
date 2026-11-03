import { Filter } from '../../types';
import { navigate } from '../../lib/route';
import { createExamplePage, setFilter, setQuery } from '../../store/notes';
import { Icon } from '../ui/Icon';
import { openNewPage } from './shared';

export function EmptyState({ total, filter, query }: { total: number; filter: Filter; query: string }) {
  if (!total) {
    return (
      <div className="empty">
        <h2>No pages yet</h2>
        <p>Create a page, then place text, images, checklists, code and tables anywhere on it.</p>
        <div className="row">
          <button className="btn primary" onClick={openNewPage}><Icon name="plus" size={16} />New page</button>
          <button
            className="btn"
            onClick={() => {
              const p = createExamplePage();
              navigate({ name: 'page', id: p.id });
            }}
          >
            Open an example page
          </button>
        </div>
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
            : 'Create a page to get started.'}
      </p>
      <div className="row">
        <button className="btn primary" onClick={openNewPage}><Icon name="plus" size={16} />New page</button>
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

