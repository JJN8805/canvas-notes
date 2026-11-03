import { memo, useMemo, useRef, useState } from 'react';
import { Filter, Group, Page } from '../../types';
import { colorVar } from '../../lib/util';
import { createGroup, deleteGroup, moveGroup, setFilter, setPageGroup, updateGroup } from '../../store/notes';
import { ask, confirmDanger, openMenu, toast } from '../../store/ui';
import { validParents, withDescendants } from '../../lib/groups';
import { searchGroups, searchTags, tagSummaries, type GroupSummary, type TagSort } from '../../lib/browse';
import { Icon } from '../ui/Icon';
import { COARSE, GROUP_MIME, groupChoices, PAGE_MIME } from './shared';

/** The ⋯ menu of a group: new subgroup, rename, colour, move and delete. */
export function openGroupMenu(anchor: HTMLElement, g: Group, groups: Group[], pageCount: number) {
  const allowed = new Set(validParents(groups, g.id).map((x) => x.id));
  const subCount = withDescendants(groups, g.id).size - 1;
  openMenu(anchor, [
    {
      label: 'New subgroup…',
      action: async () => {
        const v = await ask({ title: `New subgroup in ${g.name}`, okLabel: 'Create subgroup', placeholder: 'Subgroup name' });
        if (v?.trim()) createGroup(v, g.id);
      },
    },
    {
      label: 'Rename…',
      action: async () => {
        const v = await ask({ title: 'Rename group', initial: g.name, okLabel: 'Rename' });
        if (v?.trim()) updateGroup(g.id, { name: v.trim().slice(0, 60) });
      },
    },
    { swatches: true, current: g.color, pick: (c) => updateGroup(g.id, { color: c }) },
    { separator: true },
    { heading: 'Move into' },
    { label: 'Top level (no parent)', check: !g.parentId, action: () => void moveGroup(g.id, null) },
    ...groupChoices(groups, g.parentId, (id) => void moveGroup(g.id, id), allowed),
    { separator: true },
    {
      label: 'Delete group…',
      danger: true,
      action: async () => {
        const parentName = g.parentId ? groups.find((x) => x.id === g.parentId)?.name : null;
        const where = parentName ? `“${parentName}”` : 'the top level';
        const parts = [
          pageCount ? `its ${pageCount} page${pageCount > 1 ? 's' : ''}` : '',
          subCount ? `${subCount} subgroup${subCount > 1 ? 's' : ''}` : '',
        ].filter(Boolean);
        const ok = await confirmDanger(
          `Delete “${g.name}”?`,
          parts.length
            ? `Only the group itself is removed. ${parts.join(' and ').replace(/^./, (c) => c.toUpperCase())} will move up to ${where}. No pages are deleted.`
            : 'This group is empty.',
          'Delete group',
        );
        if (ok) deleteGroup(g.id);
      },
    },
  ]);
}


/* ---------------- Groups and tags pages ---------------- */

/** Where you are, as links back up: "Groups / Work / ML projects". */
export function Crumbs({ trail }: { trail: { label: string; to: Filter }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {trail.map((c, i) => (
        <span key={i}>
          <button onClick={() => setFilter(c.to)}>{i === 0 ? '← ' : ''}{c.label}</button>
          {i < trail.length - 1 && ' / '}
        </span>
      ))}
    </nav>
  );
}

/** A group as a card: click to open it. Drag a page onto it to move the page in, or a group onto it to nest that group. */
export const GroupCard = memo(function GroupCard({ s, groups, showPath }: { s: GroupSummary; groups: Group[]; showPath?: boolean }) {
  const g = s.group;
  const menuRef = useRef<HTMLButtonElement>(null);
  const [over, setOver] = useState(false);
  const open = () => setFilter({ kind: 'group', id: g.id });
  const place = s.path.slice(0, -1).join(' / ');
  return (
    <article
      className={'bcard' + (over ? ' drop-ok' : '')}
      style={{ '--gc': colorVar(g.color) } as React.CSSProperties}
      tabIndex={0}
      aria-label={`Open ${g.name}`}
      onClick={open}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          open();
        }
      }}
      draggable={!COARSE}
      onDragStart={(e) => {
        e.dataTransfer.setData(GROUP_MIME, g.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PAGE_MIME) || e.dataTransfer.types.includes(GROUP_MIME)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const pageId = e.dataTransfer.getData(PAGE_MIME);
        const groupId = e.dataTransfer.getData(GROUP_MIME);
        if (pageId) {
          setPageGroup(pageId, g.id);
          toast(`Moved to ${g.name}`);
        } else if (groupId && groupId !== g.id) {
          if (moveGroup(groupId, g.id)) toast(`Moved into ${g.name}`);
          else toast('A group can’t go inside one of its own subgroups.');
        }
      }}
    >
      <span className="bcard-ico"><Icon name="folder" size={22} /></span>
      <div className="bcard-body">
        <div className="bcard-title" title={g.name}>{g.name}</div>
        {showPath && place && <div className="bcard-path" title={place}>in {place}</div>}
        <div className="bcard-meta">
          {s.pages} page{s.pages === 1 ? '' : 's'}
          {s.subgroups > 0 && ` · ${s.subgroups} subgroup${s.subgroups === 1 ? '' : 's'}`}
        </div>
      </div>
      <button
        ref={menuRef}
        className="icon-btn bmenu"
        aria-label={`Options for ${g.name}`}
        onClick={(e) => {
          e.stopPropagation();
          if (menuRef.current) openGroupMenu(menuRef.current, g, groups, s.pages);
        }}
      >
        <Icon name="more" size={16} />
      </button>
    </article>
  );
});

export function GroupsView({ summaries }: { summaries: GroupSummary[] }) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => summaries.map((s) => s.group), [summaries]);
  const shown = useMemo(() => searchGroups(summaries, q), [summaries, q]);
  const searching = !!q.trim();
  const create = async () => {
    const v = await ask({ title: 'New group', okLabel: 'Create group', placeholder: 'Group name' });
    if (v?.trim()) createGroup(v);
  };
  return (
    <>
      <div className="main-head">
        <div className="main-title">
          <h1>Groups</h1>
          <p>
            {searching ? `${shown.length} of ${summaries.length} groups match “${q.trim()}”` : `${summaries.length} group${summaries.length === 1 ? '' : 's'}. Open one to see its pages and subgroups.`}
          </p>
        </div>
        <div className="controls">
          <label className="search-wrap">
            <Icon name="search" size={16} />
            <input
              className="field search"
              type="search"
              placeholder="Search groups"
              aria-label="Search groups"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <button className="btn primary" onClick={() => void create()}>
            <Icon name="plus" size={16} />
            New group
          </button>
        </div>
      </div>
      {shown.length ? (
        <div className="bgrid">
          {shown.map((s) => (
            <GroupCard key={s.group.id} s={s} groups={groups} showPath={searching} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>{searching ? 'No groups match your search' : 'No groups yet'}</h2>
          <p>{searching ? 'Try a different word, or clear the search. Subgroups are searched too.' : 'Groups keep related pages together, and can hold subgroups.'}</p>
          <div className="row">
            {searching ? (
              <button className="btn" onClick={() => setQ('')}>Clear search</button>
            ) : (
              <button className="btn primary" onClick={() => void create()}><Icon name="plus" size={16} />New group</button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function TagsView({ pages }: { pages: Page[] }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<TagSort>('name');
  const all = useMemo(() => tagSummaries(pages), [pages]);
  const shown = useMemo(() => searchTags(all, q, sort), [all, q, sort]);
  const searching = !!q.trim();
  return (
    <>
      <div className="main-head">
        <div className="main-title">
          <h1>Tags</h1>
          <p>
            {searching ? `${shown.length} of ${all.length} tags match “${q.trim()}”` : `${all.length} tag${all.length === 1 ? '' : 's'}. Open one to see its pages.`}
          </p>
        </div>
        <div className="controls">
          <label className="search-wrap">
            <Icon name="search" size={16} />
            <input
              className="field search"
              type="search"
              placeholder="Search tags"
              aria-label="Search tags"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select className="field" aria-label="Sort tags" value={sort} onChange={(e) => setSort(e.target.value as TagSort)}>
            <option value="name">Name A–Z</option>
            <option value="count">Most pages</option>
          </select>
        </div>
      </div>
      {shown.length ? (
        <div className="bgrid">
          {shown.map((t) => (
            <button key={t.tag} className="bcard tagcard" onClick={() => setFilter({ kind: 'tag', tag: t.tag })} aria-label={`Open tag ${t.tag}`}>
              <span className="bcard-ico"><Icon name="tag" size={20} /></span>
              <span className="bcard-body">
                <span className="bcard-title" title={'#' + t.tag}>#{t.tag}</span>
                <span className="bcard-meta">{t.count} page{t.count === 1 ? '' : 's'}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>{searching ? 'No tags match your search' : 'No tags yet'}</h2>
          <p>{searching ? 'Try a different word, or clear the search.' : 'Add tags to a page from its header and they will be listed here.'}</p>
          {searching && (
            <div className="row">
              <button className="btn" onClick={() => setQ('')}>Clear search</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

