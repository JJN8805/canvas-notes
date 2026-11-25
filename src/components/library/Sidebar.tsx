import { APP_NAME, buildInfo } from '../../lib/appInfo';
import { useMemo, useState } from 'react';
import { Filter, Group, Page } from '../../types';
import { archivedPages, cardsOf, templatesOf } from '../../lib/pages';
import { openSettings } from '../../store/settingsUi';
import { usePrefs } from '../../store/prefs';
import { Avatar } from '../ui/Avatar';
import { loadTrash, setFilter, setPageGroup, useNotes } from '../../store/notes';
import { toast } from '../../store/ui';
import { tagSummaries } from '../../lib/browse';
import { Icon, type IconName } from '../ui/Icon';
import { PAGE_MIME, openNewPage } from './shared';
import { createCount, openCreateMenu } from './createMenu';
import { addonScreens, askHandler, useAddons } from '../../addons/store';
import { journalEntries } from '../../lib/journal';
import { openNav } from '../../store/nav';
import { MOD_LABEL } from '../../lib/util';
import { toggleSidebar } from '../../store/layout';
import { useFeature, useFeatures } from '../../store/features';
import { navigate } from '../../lib/route';
import { listedPages } from '../../lib/pages';
import { WorkspaceDrops, WorkspaceSwitcher } from './WorkspaceSwitcher';
import { favoritePages, recentPages } from '../../lib/favorites';
import { toggleStar, useFavorites } from '../../store/favorites';

/** The one place to make anything: a page, a card, a document, a script… (the menu lists only what this copy of the app has on). */
function NewButton() {
  useFeatures((s) => s.disabled);
  useAddons((s) => s.loaded);
  return (
    <button className="side-new" onClick={(e) => (createCount() > 1 ? openCreateMenu(e.currentTarget) : openNewPage())} aria-haspopup="menu" title="Make something new">
      <Icon name="plus" size={16} />
      <span>New</span>
    </button>
  );
}

/* ---------------- Sidebar ---------------- */

export function Sidebar({ pages, groups, filter }: { pages: Page[]; groups: Group[]; filter: Filter }) {
  const storageKind = useNotes((s) => s.storageKind);
  const storageLocation = useNotes((s) => s.storageLocation);
  const tagCount = useMemo(() => tagSummaries(pages).length, [pages]);
  const groupIds = new Set(groups.map((g) => g.id));
  const cardCount = useNotes((s) => cardsOf(s.pages).length);
  const trashCount = useNotes((s) => s.trash.length);
  const archiveCount = useNotes((s) => archivedPages(s.pages).length);
  const archiveOn = useFeature('archive');
  const journalCount = useNotes((s) => journalEntries(s.pages).length);
  const templateCount = useNotes((s) => templatesOf(s.pages).length);
  const ungrouped = pages.filter((p) => !p.groupId || !groupIds.has(p.groupId)).length;
  useAddons((s) => s.loaded); // re-render when an add-on starts or stops, so its screens and the "ask" wording follow
  const screens = addonScreens();
  const canAsk = !!askHandler();
  useFeatures((s) => s.disabled); // the Workspace entry depends on which features are on
  const journalOn = useFeature('journal');
  const groupsOn = useFeature('groups');
  const tagsOn = useFeature('tags');
  const cardsOn = useFeature('cards');
  const templatesOn = useFeature('templates');

  return (
    <nav className="sidebar" aria-label="Pages, groups and tags">
      <div className="brand">
        <span className="brand-mark" />
        Canvas Notes
        <button className="icon-btn side-toggle" onClick={toggleSidebar} aria-label="Hide sidebar" title={`Hide sidebar (${MOD_LABEL}+\\)`}>
          <Icon name="sidebar" size={16} />
        </button>
      </div>
      <ProfileChip />
      <WorkspaceSwitcher />
      <WorkspaceDrops />

      <NewButton />

      <button className="side-search" onClick={() => openNav('switcher')} aria-label={`${canAsk ? 'Search or ask' : 'Search'} (${MOD_LABEL}+K)`}>
        <Icon name="search" size={15} />
        <span className="side-search-label">{canAsk ? 'Search or ask' : 'Search'}</span>
        <kbd>{MOD_LABEL}+K</kbd>
      </button>

      <PageShortcuts />

      <div className="side-section" aria-label="Library">
        <div className="side-head">Library</div>
        <NavItem icon="pages" label="All pages" count={pages.length} active={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })} />
        {cardsOn && <NavItem icon="card" label="Cards" count={cardCount} active={filter.kind === 'cards'} onClick={() => setFilter({ kind: 'cards' })} />}
        {journalOn && <NavItem icon="book" label="Journal" count={journalCount} active={filter.kind === 'journal'} onClick={() => setFilter({ kind: 'journal' })} />}
      </div>

      {(groupsOn || tagsOn) && (
        <div className="side-section" aria-label="Organize">
          <div className="side-head">Organize</div>
          {groupsOn && (
            <NavItem icon="folder" label="Groups" count={groups.length} active={filter.kind === 'groups' || filter.kind === 'group'} onClick={() => setFilter({ kind: 'groups' })} />
          )}
          {tagsOn && <NavItem icon="tag" label="Tags" count={tagCount} active={filter.kind === 'tags' || filter.kind === 'tag'} onClick={() => setFilter({ kind: 'tags' })} />}
          {groupsOn && ungrouped > 0 && (
            <NavItem icon="pages" label="Not in a group" count={ungrouped} active={filter.kind === 'ungrouped'} onClick={() => setFilter({ kind: 'ungrouped' })} dropGroup={null} />
          )}
        </div>
      )}

      {screens.length > 0 && (
        <div className="side-section" aria-label="Studio">
          {screens.length > 1 && <div className="side-head">Studio</div>}
          {screens.map((s) => (
            <NavItem key={s.id} icon={s.icon} label={s.label} active={filter.kind === 'addon' && filter.id === s.id} onClick={() => setFilter({ kind: 'addon', id: s.id })} />
          ))}
        </div>
      )}

      <div className="side-section side-manage" aria-label="Manage">
        {templatesOn && <NavItem icon="template" label="Templates" count={templateCount} active={filter.kind === 'templates'} onClick={() => setFilter({ kind: 'templates' })} />}
        {archiveOn && <NavItem icon="archive" label="Archive" count={archiveCount} active={filter.kind === 'archive'} onClick={() => setFilter({ kind: 'archive' })} />}
        <NavItem
          icon="trash"
          label="Trash"
          count={trashCount}
          active={filter.kind === 'trash'}
          onClick={() => {
            setFilter({ kind: 'trash' });
            void loadTrash();
          }}
        />
      </div>

      <button className="side-settings" onClick={openSettings}>
        <Icon name="settings" size={16} />
        Settings
      </button>
      <div className="side-foot" title={storageLocation}>
        {storageKind === 'desktop' ? `Stored on this computer in ${storageLocation}` : 'Development mode: stored in this browser only.'}
        <div className="side-ver">
          {APP_NAME} {buildInfo().version}
        </div>
      </div>
    </nav>
  );
}

/** Starred pages and the ones edited last, a click away (Notion's Favorites and Recent). Nothing shows until there is something to list. */
function PageShortcuts() {
  const pages = useNotes((s) => s.pages);
  const ids = useFavorites((s) => s.ids);
  const listed = useMemo(() => listedPages(pages), [pages]);
  const starred = useMemo(() => favoritePages(ids, listed), [ids, listed]);
  const recent = useMemo(() => recentPages(listed, ids), [ids, listed]);
  if (!starred.length && !recent.length) return null;
  const row = (p: Page, star: boolean) => (
    <div key={p.id} className="side-page">
      <button className="nav-item" onClick={() => navigate({ name: 'page', id: p.id })} title={p.title.trim() || 'Untitled'}>
        <span className="nav-ico">{p.icon ? <span className="page-icon" aria-hidden="true">{p.icon}</span> : <Icon name={star ? 'star' : 'pages'} size={16} />}</span>
        <span className="lbl">{p.title.trim() || 'Untitled'}</span>
      </button>
      {star && (
        <button className="icon-btn side-unstar" aria-label={`Remove ${p.title.trim() || 'Untitled'} from favorites`} title="Remove from favorites" onClick={() => toggleStar(p.id)}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
  return (
    <>
      {starred.length > 0 && (
        <div className="side-section" aria-label="Favorites">
          <div className="side-head">Favorites</div>
          {starred.map((p) => row(p, true))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="side-section" aria-label="Recent">
          <div className="side-head">Recent</div>
          {recent.map((p) => row(p, false))}
        </div>
      )}
    </>
  );
}

/** The profile name and avatar under the app name; opens Settings. Shows nothing until a name is set. */
export function ProfileChip() {
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


export function NavItem(props: { label: string; count?: number; active: boolean; onClick: () => void; dropGroup?: string | null; icon?: IconName }) {
  const [over, setOver] = useState(false);
  const droppable = props.dropGroup !== undefined;
  return (
    <button
      className={'nav-item' + (over ? ' drop-ok' : '')}
      aria-current={props.active ? 'true' : undefined}
      onClick={props.onClick}
      onDragOver={
        droppable
          ? (e) => {
              if (e.dataTransfer.types.includes(PAGE_MIME)) {
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
              if (pageId) {
                setPageGroup(pageId, props.dropGroup ?? null);
                toast('Moved to Ungrouped');
              }
            }
          : undefined
      }
    >
      {props.icon && <span className="nav-ico"><Icon name={props.icon} size={16} /></span>}
      <span className="lbl" title={props.label}>{props.label}</span>
      {props.count !== undefined && props.count > 0 && <span className="cnt">{props.count}</span>}
    </button>
  );
}

