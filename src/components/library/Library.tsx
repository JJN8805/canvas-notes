import { useMemo } from 'react';
import { Filter, Group } from '../../types';
import { searchPages } from '../../lib/search';
import { libraryPages } from '../../lib/pages';
import { CalendarButton, goToDay } from '../ui/Calendar';
import { dateKey } from '../../lib/daily';
import { setQuery, setSort, useNotes } from '../../store/notes';
import { groupPath, withDescendants } from '../../lib/groups';
import { childSummaries, groupAncestors, groupSummaries } from '../../lib/browse';
import { CardsView } from '../cards/CardsView';
import { Icon } from '../ui/Icon';
import { SyncButton } from '../sync/SyncPanel';
import { openNewPage } from './shared';
import { EmptyState } from './EmptyState';
import { TemplatesView } from './TemplatesView';
import { TrashView } from './TrashView';
import { Sidebar } from './Sidebar';
import { Crumbs, GroupCard, GroupsView, TagsView } from './Browse';
import { PageCard } from './PageCard';

function filterTitle(f: Filter, groups: Group[]): string {
  if (f.kind === 'group') return groupPath(groups, f.id).join(' / ') || 'Group';
  if (f.kind === 'ungrouped') return 'Ungrouped';
  if (f.kind === 'tag') return '#' + f.tag;
  if (f.kind === 'groups') return 'Groups';
  if (f.kind === 'tags') return 'Tags';
  if (f.kind === 'cards') return 'Cards';
  if (f.kind === 'trash') return 'Trash';
  if (f.kind === 'templates') return 'Templates';
  return 'All pages';
}


export function Library() {
  const pages = useNotes((s) => s.pages);
  const groups = useNotes((s) => s.groups);
  const filter = useNotes((s) => s.filter);
  const query = useNotes((s) => s.query);
  const sort = useNotes((s) => s.sort);

  // Templates are not pages: they stay out of the list, search, counts and tags.
  const all = useMemo(() => libraryPages(pages), [pages]);
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);

  const inGroup = useMemo(() => (filter.kind === 'group' ? withDescendants(groups, filter.id) : null), [filter, groups]);

  const list = useMemo(() => {
    const inView = all.filter((p) => {
      if (inGroup && !(p.groupId && inGroup.has(p.groupId))) return false;
      if (filter.kind === 'ungrouped' && p.groupId && groupIds.has(p.groupId)) return false;
      if (filter.kind === 'tag' && !p.tags.includes(filter.tag)) return false;
      return true;
    });
    const out = searchPages(inView, query, groups);
    if (sort === 'title') out.sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'));
    else if (sort === 'created') out.sort((a, b) => b.created - a.created);
    else out.sort((a, b) => b.updated - a.updated);
    return out;
  }, [all, filter, query, sort, groupIds, inGroup, groups]);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const summaries = useMemo(() => groupSummaries(groups, all), [groups, all]);
  const subgroups = useMemo(() => (filter.kind === 'group' ? childSummaries(summaries, filter.id) : []), [summaries, filter]);

  return (
    <div className="library">
      <Sidebar pages={all} groups={groups} filter={filter} />
      <main className="main">
        {filter.kind === 'trash' ? (
          <TrashView />
        ) : filter.kind === 'templates' ? (
          <TemplatesView />
        ) : filter.kind === 'cards' ? (
          <CardsView />
        ) : filter.kind === 'groups' ? (
          <GroupsView summaries={summaries} />
        ) : filter.kind === 'tags' ? (
          <TagsView pages={all} />
        ) : (
          <>
        {filter.kind === 'group' && (
          <Crumbs
            trail={[{ label: 'Groups', to: { kind: 'groups' } }, ...groupAncestors(groups, filter.id).map((a) => ({ label: a.name, to: { kind: 'group', id: a.id } as Filter }))]}
          />
        )}
        {filter.kind === 'tag' && <Crumbs trail={[{ label: 'Tags', to: { kind: 'tags' } }]} />}
        <div className="main-head">
          <div className="main-title">
            <h1>{filterTitle(filter, groups)}</h1>
            <p>
              {list.length} page{list.length === 1 ? '' : 's'}
              {query ? ` matching “${query}”` : ''}
            </p>
          </div>
          <div className="controls">
            <label className="search-wrap">
              <Icon name="search" size={16} />
              <input
                className="field search"
                type="search"
                placeholder="Search pages"
                title="Words must all appear. Narrow with: #tag  has:image  in:groupname  after:2026-01-01  before:2026-02-01  and &quot;exact phrase&quot;"
                aria-label="Search pages"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select className="field" aria-label="Sort pages" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="updated">Last edited</option>
              <option value="created">Newest</option>
              <option value="title">Title A–Z</option>
            </select>
            <SyncButton />
            <button className="btn" title="Open today's page (Ctrl+Alt+D)" onClick={() => goToDay(dateKey())}>
              <Icon name="today" size={16} />
              Today
            </button>
            <CalendarButton />
            <button className="btn primary" onClick={openNewPage}>
              <Icon name="plus" size={16} />
              New page
            </button>
          </div>
        </div>

        {subgroups.length > 0 && (
          <section aria-label="Subgroups">
            <h2 className="browse-head">Subgroups</h2>
            <div className="bgrid">
              {subgroups.map((sg) => (
                <GroupCard key={sg.group.id} s={sg} groups={groups} />
              ))}
            </div>
            <h2 className="browse-head">Pages</h2>
          </section>
        )}
        {list.length ? (
          <div className="cards">
            {list.map((p) => (
              <PageCard key={p.id} page={p} group={p.groupId ? groupById.get(p.groupId) ?? null : null} />
            ))}
          </div>
        ) : (
          <EmptyState total={all.length} filter={filter} query={query} />
        )}
          </>
        )}
      </main>
    </div>
  );
}

