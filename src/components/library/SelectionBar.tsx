import { useEffect } from 'react';
import type { Group } from '../../types';
import { cancelSelect, selectAllOf, useSelect } from '../../store/librarySelect';
import { archivable, archivePages, deletePages, movePages } from '../../store/bulkPages';
import { openMenu } from '../../store/ui';
import { useFeature } from '../../store/features';
import { pagesWord, pickedIn } from '../../lib/selection';
import { Icon } from '../ui/Icon';
import { groupChoices } from './shared';
import { workspaceMoveItems } from './workspaceMenu';

/** The bar that appears while pages are being picked in the library: what is picked, and what to do with them together. */
export function SelectionBar({ shown, groups }: { shown: string[]; groups: Group[] }) {
  const { on, ids } = useSelect();
  const archiveOn = useFeature('archive');
  const groupsOn = useFeature('groups');
  const wsOn = useFeature('workspaces');
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.scrim, .menu') && cancelSelect();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [on]);
  if (!on) return null;
  const picked = pickedIn(ids, shown);
  const done = (n: number) => n > 0 && cancelSelect();
  return (
    <div className="select-bar" role="toolbar" aria-label="Picked pages">
      <span className="select-count" aria-live="polite">{picked.length ? `${pagesWord(picked.length)} picked` : 'Pick pages'}</span>
      <button className="btn small" onClick={() => selectAllOf(picked.length === shown.length ? [] : shown)}>{picked.length === shown.length && shown.length ? 'Pick none' : 'Pick all'}</button>
      {archiveOn && (
        <button className="btn small" aria-label="Archive the picked pages" title="Archive" disabled={!archivable(picked).length} onClick={() => done(archivePages(archivable(picked)))}>
          <Icon name="archive" size={16} />
          <span className="sb-lbl">Archive</span>
        </button>
      )}
      {groupsOn && (
        <button
          className="btn small"
          aria-label="Move the picked pages to a group"
          title="Move to a group"
          disabled={!picked.length}
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { heading: 'Move to' },
              { label: 'No group', action: () => (movePages(picked, null, ''), cancelSelect()) },
              ...groupChoices(groups.filter((g) => g.scope !== 'cards'), null, (gid) => {
                movePages(picked, gid, groups.find((g) => g.id === gid)?.name ?? 'the group');
                cancelSelect();
              }),
            ])
          }
        >
          <Icon name="folder" size={16} />
          <span className="sb-lbl">Move to…</span>
        </button>
      )}
      {wsOn && workspaceMoveItems(shown).length > 0 && (
        <button className="btn small" aria-label="Move or copy the picked pages to another workspace" title="Move or copy to another workspace" disabled={!picked.length} onClick={(e) => openMenu(e.currentTarget, workspaceMoveItems(picked, cancelSelect).slice(0, -1))}>
          <Icon name="pages" size={16} />
          <span className="sb-lbl">Workspace…</span>
        </button>
      )}
      <button className="btn small danger-text" aria-label="Delete the picked pages" title="Delete" disabled={!picked.length} onClick={() => void deletePages(picked).then(done)}>
        <Icon name="trash" size={16} />
        <span className="sb-lbl">Delete</span>
      </button>
      <button className="btn small" onClick={cancelSelect}>Cancel</button>
    </div>
  );
}
