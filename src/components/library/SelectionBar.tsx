import { useEffect } from 'react';
import type { Group } from '../../types';
import { cancelSelect, selectAllOf, useSelect } from '../../store/librarySelect';
import { archivable, archivePages, deletePages, movePages } from '../../store/bulkPages';
import { openMenu } from '../../store/ui';
import { useFeature } from '../../store/features';
import { pagesWord, pickedIn } from '../../lib/selection';
import { Icon } from '../ui/Icon';
import { groupChoices } from './shared';

/** The bar that appears while pages are being picked in the library: what is picked, and what to do with them together. */
export function SelectionBar({ shown, groups }: { shown: string[]; groups: Group[] }) {
  const { on, ids } = useSelect();
  const archiveOn = useFeature('archive');
  const groupsOn = useFeature('groups');
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
        <button className="btn small" disabled={!archivable(picked).length} onClick={() => done(archivePages(archivable(picked)))}>
          <Icon name="archive" size={16} />
          Archive
        </button>
      )}
      {groupsOn && (
        <button
          className="btn small"
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
          Move to…
        </button>
      )}
      <button className="btn small danger-text" disabled={!picked.length} onClick={() => void deletePages(picked).then(done)}>
        <Icon name="trash" size={16} />
        Delete
      </button>
      <button className="btn small" onClick={cancelSelect}>Cancel</button>
    </div>
  );
}
