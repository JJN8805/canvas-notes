import { useMemo, useState } from 'react';
import { Filter, Group, Page } from '../../types';
import { cardsOf, templatesOf } from '../../lib/pages';
import { openSettings } from '../../store/settingsUi';
import { usePrefs } from '../../store/prefs';
import { Avatar } from '../ui/Avatar';
import { loadTrash, setFilter, setPageGroup, useNotes } from '../../store/notes';
import { toast } from '../../store/ui';
import { tagSummaries } from '../../lib/browse';
import { Icon, type IconName } from '../ui/Icon';
import { PAGE_MIME } from './shared';
import { addonScreens, askHandler, useAddons } from '../../addons/store';
import { journalEntries } from '../../lib/journal';
import { openNav } from '../../store/nav';
import { MOD_LABEL } from '../../lib/util';

/* ---------------- Sidebar ---------------- */

export function Sidebar({ pages, groups, filter }: { pages: Page[]; groups: Group[]; filter: Filter }) {
  const storageKind = useNotes((s) => s.storageKind);
  const storageLocation = useNotes((s) => s.storageLocation);
  const tagCount = useMemo(() => tagSummaries(pages).length, [pages]);
  const groupIds = new Set(groups.map((g) => g.id));
  const cardCount = useNotes((s) => cardsOf(s.pages).length);
  const trashCount = useNotes((s) => s.trash.length);
  const journalCount = useNotes((s) => journalEntries(s.pages).length);
  const templateCount = useNotes((s) => templatesOf(s.pages).length);
  const ungrouped = pages.filter((p) => !p.groupId || !groupIds.has(p.groupId)).length;
  useAddons((s) => s.loaded); // re-render when an add-on starts or stops, so its screens and the "ask" wording follow
  const screens = addonScreens();
  const canAsk = !!askHandler();

  return (
    <nav className="sidebar" aria-label="Pages, groups and tags">
      <div className="brand">
        <span className="brand-mark" />
        Canvas Notes
      </div>
      <ProfileChip />

      <button className="side-search" onClick={() => openNav('switcher')} aria-label={`${canAsk ? 'Search or ask' : 'Search'} (${MOD_LABEL}+K)`}>
        <Icon name="search" size={15} />
        <span className="side-search-label">{canAsk ? 'Search or ask' : 'Search'}</span>
        <kbd>{MOD_LABEL}+K</kbd>
      </button>

      <div className="side-section">
        {screens.map((s) => (
          <NavItem key={s.id} icon={s.icon} label={s.label} active={filter.kind === 'addon' && filter.id === s.id} onClick={() => setFilter({ kind: 'addon', id: s.id })} />
        ))}
        <NavItem icon="book" label="Journal" count={journalCount} active={filter.kind === 'journal'} onClick={() => setFilter({ kind: 'journal' })} />
        <NavItem icon="pages" label="All pages" count={pages.length} active={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })} />
        <NavItem
          icon="folder"
          label="Groups"
          count={groups.length}
          active={filter.kind === 'groups' || filter.kind === 'group'}
          onClick={() => setFilter({ kind: 'groups' })}
        />
        <NavItem icon="tag" label="Tags" count={tagCount} active={filter.kind === 'tags' || filter.kind === 'tag'} onClick={() => setFilter({ kind: 'tags' })} />
        <NavItem icon="card" label="Cards" count={cardCount} active={filter.kind === 'cards'} onClick={() => setFilter({ kind: 'cards' })} />
        <NavItem
          icon="pages"
          label="Ungrouped"
          count={ungrouped}
          active={filter.kind === 'ungrouped'}
          onClick={() => setFilter({ kind: 'ungrouped' })}
          dropGroup={null}
        />
        <NavItem
          icon="template"
          label="Templates"
          count={templateCount}
          active={filter.kind === 'templates'}
          onClick={() => setFilter({ kind: 'templates' })}
        />
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
      </div>
    </nav>
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
      {props.count !== undefined && <span className="cnt">{props.count}</span>}
    </button>
  );
}

