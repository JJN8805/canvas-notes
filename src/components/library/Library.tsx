import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Filter, Group, NoteColor, Page } from '../../types';
import { cleanColor, noteVar } from '../../lib/colors';
import { blockText, colorVar, timeAgo } from '../../lib/util';
import { libraryPages, resolveDailyTemplate, templatesOf } from '../../lib/pages';
import { CalendarButton, goToDay } from '../ui/Calendar';
import { dateKey } from '../../lib/daily';
import { openSettings } from '../../store/settingsUi';
import { usePrefs } from '../../store/prefs';
import { Avatar } from '../ui/Avatar';
import { daysLeft } from '../../lib/history';
import { navigate } from '../../lib/route';
import { openTemplatePicker } from '../../store/picker';
import {
  chooseDailyTemplate,
  createExamplePage,
  createGroup,
  createPageFromTemplate,
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  renameTemplate,
  deleteForever,
  deleteGroup,
  loadTrash,
  restoreFromTrash,
  moveGroup,
  toggleCollapsed,
  deletePage,
  duplicatePage,
  mutatePage,
  setFilter,
  saveAsTemplate,
  setPageColor,
  setPageGroup,
  setQuery,
  setSort,
  updateGroup,
  useNotes,
} from '../../store/notes';
import { ask, confirmDanger, openMenu, toast, type MenuItem } from '../../store/ui';
import { groupPath, groupTree, validParents, withDescendants } from '../../lib/groups';
import { Icon } from '../ui/Icon';
import { Thumbnail } from './Thumbnail';
import { SyncButton } from '../sync/SyncPanel';
import { EXPORT_ITEMS } from '../../export/export';

const PAGE_MIME = 'application/x-canvas-page';
const GROUP_MIME = 'application/x-canvas-group';
/** Touch screens: no drag-to-group (long-press opens the menu instead). */
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

function filterTitle(f: Filter, groups: Group[]): string {
  if (f.kind === 'group') return groupPath(groups, f.id).join(' / ') || 'Group';
  if (f.kind === 'ungrouped') return 'Ungrouped';
  if (f.kind === 'tag') return '#' + f.tag;
  if (f.kind === 'trash') return 'Trash';
  if (f.kind === 'templates') return 'Templates';
  return 'All pages';
}

function openNewPage() {
  openTemplatePicker();
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
    const q = query.trim().toLowerCase();
    const out = all.filter((p) => {
      if (inGroup && !(p.groupId && inGroup.has(p.groupId))) return false;
      if (filter.kind === 'ungrouped' && p.groupId && groupIds.has(p.groupId)) return false;
      if (filter.kind === 'tag' && !p.tags.includes(filter.tag)) return false;
      if (q) {
        const hay = [p.title, p.tags.join(' '), ...p.blocks.map(blockText)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sort === 'title') out.sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'));
    else if (sort === 'created') out.sort((a, b) => b.created - a.created);
    else out.sort((a, b) => b.updated - a.updated);
    return out;
  }, [all, filter, query, sort, groupIds, inGroup]);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  return (
    <div className="library">
      <Sidebar pages={all} groups={groups} filter={filter} />
      <main className="main">
        {filter.kind === 'trash' ? (
          <TrashView />
        ) : filter.kind === 'templates' ? (
          <TemplatesView />
        ) : (
          <>
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
              Today
            </button>
            <CalendarButton />
            <button className="btn primary" onClick={openNewPage}>
              <Icon name="plus" size={16} />
              New page
            </button>
          </div>
        </div>

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

function EmptyState({ total, filter, query }: { total: number; filter: Filter; query: string }) {
  if (!total) {
    return (
      <div className="empty">
        <h2>No pages yet</h2>
        <p>Create a page, then place text, images, checklists, code and tables anywhere on it.</p>
        <div className="row">
          <button className="btn primary" onClick={openNewPage}>New page</button>
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
          ? 'Try a different word, or clear the search.'
          : filter.kind === 'group'
            ? 'Create a page here, or drag a card onto this group in the sidebar.'
            : 'Create a page to get started.'}
      </p>
      <div className="row">
        <button className="btn primary" onClick={openNewPage}>New page</button>
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

/* ---------------- Templates ---------------- */

function openTemplate(id: string) {
  navigate({ name: 'page', id });
}

function TemplatesView() {
  const pages = useNotes((s) => s.pages);
  const templates = useMemo(() => templatesOf(pages), [pages]);
  const dailySetting = usePrefs((s) => s.dailyTemplate);
  const dailyId = resolveDailyTemplate(pages, dailySetting)?.id ?? null;
  return (
    <>
      <div className="main-head">
        <div className="main-title">
          <h1>Templates</h1>
          <p>
            {templates.length} template{templates.length === 1 ? '' : 's'}. A page made from one is its own copy, so changing a template never changes pages you already made.
          </p>
        </div>
        <div className="controls">
          <button className="btn primary" onClick={() => openTemplate(createTemplate().id)}>
            <Icon name="plus" size={16} />
            New template
          </button>
        </div>
      </div>
      {templates.length ? (
        <div className="cards">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} isDaily={t.id === dailyId} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>No templates</h2>
          <p>Save any page as a template from its card menu, or make a new one here.</p>
        </div>
      )}
    </>
  );
}

const TemplateCard = memo(function TemplateCard({ template: t, isDaily }: { template: Page; isDaily: boolean }) {
  const menuRef = useRef<HTMLButtonElement>(null);
  const showMenu = () => {
    if (!menuRef.current) return;
    openMenu(menuRef.current, [
      { label: 'Edit template', action: () => openTemplate(t.id) },
      {
        label: 'New page from this',
        action: () => {
          const p = createPageFromTemplate(t.id);
          if (p) navigate({ name: 'page', id: p.id });
        },
      },
      { separator: true },
      {
        label: 'Rename…',
        action: async () => {
          const v = await ask({ title: 'Rename template', initial: t.title, okLabel: 'Rename', placeholder: 'Template name' });
          if (v !== null) renameTemplate(t.id, v);
        },
      },
      { label: 'Duplicate', action: () => void duplicateTemplate(t.id) },
      { label: 'Use for daily pages', check: isDaily, action: () => chooseDailyTemplate(t.id) },
      { separator: true },
      {
        label: 'Delete template',
        danger: true,
        action: async () => {
          const ok = await confirmDanger(
            `Delete “${t.title || 'Untitled template'}”?`,
            'Pages already made from it are not affected. This removes the template from your other devices the next time they sync, and cannot be undone.',
            'Delete template',
          );
          if (ok) await deleteTemplate(t.id);
        },
      },
    ]);
  };
  return (
    <article
      className="card"
      tabIndex={0}
      aria-label={`Edit template ${t.title || 'Untitled template'}`}
      onClick={() => openTemplate(t.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openTemplate(t.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        showMenu();
      }}
    >
      <Thumbnail blocks={t.blocks} arrows={t.arrows} drawing={t.drawing} />
      <button
        ref={menuRef}
        className="icon-btn card-menu"
        aria-label={`Options for ${t.title || 'Untitled template'}`}
        onClick={(e) => {
          e.stopPropagation();
          showMenu();
        }}
      >
        <Icon name="more" />
      </button>
      <div className="card-body">
        <div className={'card-title' + (t.title ? '' : ' untitled')}>{t.title || 'Untitled template'}</div>
        <div className="card-meta">{isDaily ? 'Used for daily pages' : timeAgo(t.updated)}</div>
      </div>
    </article>
  );
});

/* ---------------- Trash ---------------- */

function TrashView() {
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

/* ---------------- Sidebar ---------------- */

function Sidebar({ pages, groups, filter }: { pages: Page[]; groups: Group[]; filter: Filter }) {
  /** null = not adding; '' = new top-level group; an id = new subgroup inside it */
  const [adding, setAdding] = useState<string | null>(null);
  const [overTop, setOverTop] = useState(false);
  const storageKind = useNotes((s) => s.storageKind);
  const storageLocation = useNotes((s) => s.storageLocation);
  const collapsedList = useNotes((s) => s.collapsed);
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);

  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pages) for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [pages]);
  const groupIds = new Set(groups.map((g) => g.id));
  const trashCount = useNotes((s) => s.trash.length);
  const templateCount = useNotes((s) => templatesOf(s.pages).length);
  const ungrouped = pages.filter((p) => !p.groupId || !groupIds.has(p.groupId)).length;
  const rows = useMemo(() => groupTree(groups, collapsed), [groups, collapsed]);
  // Counts include pages in subgroups.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) {
      const inside = withDescendants(groups, g.id);
      m.set(g.id, pages.filter((p) => p.groupId && inside.has(p.groupId)).length);
    }
    return m;
  }, [groups, pages]);

  return (
    <nav className="sidebar" aria-label="Pages and groups">
      <div className="brand">
        <span className="brand-mark" />
        Canvas Notes
      </div>
      <ProfileChip />

      <div className="side-section">
        <NavItem label="All pages" count={pages.length} active={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })} />
        <NavItem
          label="Ungrouped"
          count={ungrouped}
          active={filter.kind === 'ungrouped'}
          onClick={() => setFilter({ kind: 'ungrouped' })}
          dropGroup={null}
        />
        <NavItem
          label="Templates"
          count={templateCount}
          active={filter.kind === 'templates'}
          onClick={() => setFilter({ kind: 'templates' })}
        />
        <NavItem
          label="Trash"
          count={trashCount}
          active={filter.kind === 'trash'}
          onClick={() => {
            setFilter({ kind: 'trash' });
            void loadTrash();
          }}
        />
      </div>

      <div className="side-section" role="tree" aria-label="Groups">
        <div
          className={'side-head' + (overTop ? ' drop-ok' : '')}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(GROUP_MIME)) {
              e.preventDefault();
              setOverTop(true);
            }
          }}
          onDragLeave={() => setOverTop(false)}
          onDrop={(e) => {
            setOverTop(false);
            const id = e.dataTransfer.getData(GROUP_MIME);
            if (id) {
              e.preventDefault();
              moveGroup(id, null);
            }
          }}
        >
          Groups
          <button className="icon-btn" aria-label="New group" title="New group" onClick={() => setAdding('')}>
            <Icon name="plus" size={16} />
          </button>
        </div>
        {adding === '' && <NewGroupInput parentId={null} depth={0} onDone={() => setAdding(null)} />}
        {rows.map(({ group: g, depth, hasChildren }) => (
          <div key={g.id} role="none">
            <NavItem
              label={g.name}
              color={g.color}
              count={counts.get(g.id) ?? 0}
              active={filter.kind === 'group' && filter.id === g.id}
              onClick={() => setFilter({ kind: 'group', id: g.id })}
              dropGroup={g.id}
              group={g}
              groups={groups}
              depth={depth}
              hasChildren={hasChildren}
              collapsed={collapsed.has(g.id)}
              onAddSubgroup={() => setAdding(g.id)}
            />
            {adding === g.id && <NewGroupInput parentId={g.id} depth={depth + 1} onDone={() => setAdding(null)} />}
          </div>
        ))}
        {!groups.length && adding === null && (
          <button className="nav-item muted" onClick={() => setAdding('')}>
            <span className="lbl">Create a group</span>
          </button>
        )}
      </div>

      <div className="side-section">
        <div className="side-head">Tags</div>
        {!tags.length && <div className="side-note">Tags you add to pages show up here.</div>}
        {tags.map(([t, n]) => {
          const active = filter.kind === 'tag' && filter.tag === t;
          return (
            <NavItem
              key={t}
              label={'#' + t}
              count={n}
              active={active}
              onClick={() => setFilter(active ? { kind: 'all' } : { kind: 'tag', tag: t })}
            />
          );
        })}
      </div>

      <button className="side-settings" onClick={openSettings}>
        Settings
      </button>
      <div className="side-foot" title={storageLocation}>
        {storageKind === 'desktop' ? `Stored on this computer in ${storageLocation}` : 'Development mode: stored in this browser only.'}
      </div>
    </nav>
  );
}

/** The profile name and avatar under the app name; opens Settings. Shows nothing until a name is set. */
function ProfileChip() {
  const name = usePrefs((s) => s.profileName);
  const color = usePrefs((s) => s.profileColor);
  if (!name) return null;
  return (
    <button className="profile-chip" onClick={openSettings} title="Open settings">
      <Avatar name={name} color={color} size={24} />
      <span>{name}</span>
    </button>
  );
}

/** Menu entries for choosing a group, indented to show nesting. */
function groupChoices(groups: Group[], current: string | null, pick: (id: string) => void, only?: Set<string>): MenuItem[] {
  return groupTree(groups)
    .filter(({ group }) => !only || only.has(group.id))
    .map(({ group, depth }) => ({
      label: '\u2002'.repeat(depth * 2) + group.name,
      dot: group.color,
      check: current === group.id,
      action: () => pick(group.id),
    }));
}

function NavItem(props: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: Group['color'];
  dropGroup?: string | null;
  group?: Group;
  groups?: Group[];
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onAddSubgroup?: () => void;
}) {
  const [over, setOver] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);
  const droppable = props.dropGroup !== undefined;
  const g = props.group;
  const depth = props.depth ?? 0;

  const groupMenu = () => {
    if (!g || !moreRef.current) return;
    const all = props.groups ?? [];
    const allowed = new Set(validParents(all, g.id).map((x) => x.id));
    const subCount = withDescendants(all, g.id).size - 1;
    openMenu(moreRef.current, [
      { label: 'New subgroup…', action: () => props.onAddSubgroup?.() },
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
      ...groupChoices(all, g.parentId, (id) => void moveGroup(g.id, id), allowed),
      { separator: true },
      {
        label: 'Delete group…',
        danger: true,
        action: async () => {
          const parentName = g.parentId ? all.find((x) => x.id === g.parentId)?.name : null;
          const where = parentName ? `“${parentName}”` : 'the top level';
          const parts = [
            props.count ? `its ${props.count} page${props.count > 1 ? 's' : ''}` : '',
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
  };

  return (
    <button
      className={'nav-item' + (over ? ' drop-ok' : '') + (depth ? ' sub' : '')}
      style={depth ? ({ '--depth': depth } as React.CSSProperties) : undefined}
      role={g ? 'treeitem' : undefined}
      aria-level={g ? depth + 1 : undefined}
      aria-expanded={g && props.hasChildren ? !props.collapsed : undefined}
      aria-current={props.active ? 'true' : undefined}
      onClick={props.onClick}
      draggable={!!g && !COARSE}
      onDragStart={
        g
          ? (e) => {
              e.dataTransfer.setData(GROUP_MIME, g.id);
              e.dataTransfer.effectAllowed = 'move';
            }
          : undefined
      }
      onDragOver={
        droppable
          ? (e) => {
              const types = e.dataTransfer.types;
              if (types.includes(PAGE_MIME) || (g && types.includes(GROUP_MIME))) {
                e.preventDefault();
                setOver(true);
              }
            }
          : undefined
      }
      onDragLeave={droppable ? () => setOver(false) : undefined}
      onDrop={
        droppable
          ? (e) => {
              e.preventDefault();
              setOver(false);
              const pageId = e.dataTransfer.getData(PAGE_MIME);
              const groupId = e.dataTransfer.getData(GROUP_MIME);
              if (pageId) {
                setPageGroup(pageId, props.dropGroup ?? null);
                toast(props.dropGroup ? `Moved to ${props.label}` : 'Moved to Ungrouped');
              } else if (groupId && g && groupId !== g.id) {
                if (moveGroup(groupId, g.id)) toast(`Moved into ${g.name}`);
                else toast('A group can’t go inside one of its own subgroups.');
              }
            }
          : undefined
      }
    >
      {g && (
        <span
          className={'caret' + (props.hasChildren ? '' : ' none') + (props.collapsed ? ' closed' : '')}
          role={props.hasChildren ? 'button' : undefined}
          aria-label={props.hasChildren ? (props.collapsed ? `Show subgroups of ${g.name}` : `Hide subgroups of ${g.name}`) : undefined}
          onClick={(e) => {
            if (!props.hasChildren) return;
            e.stopPropagation();
            toggleCollapsed(g.id);
          }}
        >
          {props.hasChildren && (
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
              <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      )}
      {props.color && <span className="dot" style={{ background: colorVar(props.color) }} />}
      <span className="lbl" title={props.label}>{props.label}</span>
      <span className="cnt">{props.count}</span>
      {g && (
        <span
          ref={moreRef}
          className="icon-btn gm"
          role="button"
          tabIndex={0}
          aria-label={`Options for ${g.name}`}
          onClick={(e) => {
            e.stopPropagation();
            groupMenu();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              groupMenu();
            }
          }}
        >
          <Icon name="more" size={16} />
        </span>
      )}
    </button>
  );
}

function NewGroupInput({ parentId, depth, onDone }: { parentId: string | null; depth: number; onDone: () => void }) {
  const [v, setV] = useState('');
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && v.trim()) {
      const g = createGroup(v, parentId);
      setFilter({ kind: 'group', id: g.id });
    }
    onDone();
  };
  return (
    <div className="new-group" style={{ '--depth': depth } as React.CSSProperties}>
      <input
        className="field"
        autoFocus
        placeholder={parentId ? 'Subgroup name' : 'Group name'}
        aria-label={parentId ? 'Subgroup name' : 'Group name'}
        maxLength={60}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}

/* ---------------- Card ---------------- */

const PageCard = memo(function PageCard({ page, group }: { page: Page; group: Group | null }) {
  const menuRef = useRef<HTMLButtonElement>(null);
  const groups = useNotes((s) => s.groups);
  const [dragging, setDragging] = useState(false);
  const pressMenuShown = useRef(false);
  const cancelPress = useRef<(() => void) | null>(null);
  const open = () => {
    if (pressMenuShown.current) {
      pressMenuShown.current = false;
      return;
    }
    navigate({ name: 'page', id: page.id });
  };

  const cardColor = cleanColor(page.color);

  const showMenu = () => {
    if (!menuRef.current) return;
    openMenu(menuRef.current, [
      { label: 'Open', action: open },
      {
        label: 'Rename…',
        action: async () => {
          const v = await ask({ title: 'Rename page', initial: page.title, okLabel: 'Rename', placeholder: 'Untitled' });
          if (v !== null) {
            mutatePage(page.id, (p) => {
              p.title = v.trim();
            }, { history: 'none' });
          }
        },
      },
      { label: 'Duplicate', action: () => duplicatePage(page.id) },
      {
        label: 'Save as template…',
        action: async () => {
          const name = await ask({ title: 'Save as template', initial: page.title, okLabel: 'Save template', placeholder: 'Template name', text: 'Keeps this page’s layout and boxes. New pages made from it are independent copies.' });
          if (name !== null && saveAsTemplate(page.id, name)) toast(`Saved template “${name.trim() || page.title || 'Untitled template'}”`);
        },
      },
      { colors: true, title: 'Card color', current: page.color ?? null, pick: (c: NoteColor | null) => setPageColor(page.id, c) },
      { separator: true },
      { heading: 'Export as' },
      ...EXPORT_ITEMS(page.id),
      { separator: true },
      { heading: 'Move to group' },
      { label: 'Ungrouped', check: !group, action: () => setPageGroup(page.id, null) },
      ...groupChoices(groups, group?.id ?? null, (id) => setPageGroup(page.id, id)),
      {
        label: 'New group…',
        action: async () => {
          const v = await ask({ title: 'New group', okLabel: 'Create group', placeholder: 'Group name' });
          if (v?.trim()) setPageGroup(page.id, createGroup(v).id);
        },
      },
      { separator: true },
      { label: 'Delete page', danger: true, action: () => void deletePage(page.id) },
    ]);
  };

  return (
    <article
      className={'card' + (group ? ' grouped' : '') + (cardColor ? ' colored' : '') + (dragging ? ' dragging' : '')}
      style={{ ...(group ? { '--gc': colorVar(group.color) } : {}), ...(cardColor ? { '--pc': noteVar(cardColor) } : {}) } as React.CSSProperties}
      tabIndex={0}
      draggable={!COARSE}
      aria-label={`Open ${page.title || 'Untitled'}`}
      onClick={open}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch') return;
        // Long-press on a phone opens the card's menu.
        cancelPress.current?.();
        pressMenuShown.current = false;
        const x0 = e.clientX, y0 = e.clientY;
        const timer = window.setTimeout(() => {
          cancelPress.current?.();
          pressMenuShown.current = true;
          navigator.vibrate?.(12);
          showMenu();
        }, 450);
        const onMove = (ev: PointerEvent) => {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) cancelPress.current?.();
        };
        const stop = () => cancelPress.current?.();
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
        cancelPress.current = () => {
          clearTimeout(timer);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', stop);
          window.removeEventListener('pointercancel', stop);
          cancelPress.current = null;
        };
      }}
      onContextMenu={(e) => {
        // Right-click on a laptop. On phones the long-press above already opened it.
        e.preventDefault();
        if (!pressMenuShown.current) showMenu();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) open();
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(PAGE_MIME, page.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      {group && <div className="tab">{group.name}</div>}
      <Thumbnail blocks={page.blocks} arrows={page.arrows} drawing={page.drawing} />
      <button
        ref={menuRef}
        className="icon-btn card-menu"
        aria-label={`Options for ${page.title || 'Untitled'}`}
        onClick={(e) => {
          e.stopPropagation();
          showMenu();
        }}
      >
        <Icon name="more" />
      </button>
      <div className="card-body">
        <div className={'card-title' + (page.title ? '' : ' untitled')}>{page.title || 'Untitled'}</div>
        <div className="card-meta">{timeAgo(page.updated)}</div>
        {page.tags.length > 0 && (
          <div className="chips">
            {page.tags.slice(0, 4).map((t) => (
              <span key={t} className="chip">#{t}</span>
            ))}
            {page.tags.length > 4 && <span className="chip">+{page.tags.length - 4}</span>}
          </div>
        )}
      </div>
    </article>
  );
});
