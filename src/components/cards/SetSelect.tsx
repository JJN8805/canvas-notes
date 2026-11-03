import { useMemo } from 'react';
import { groupPath, groupTree } from '../../lib/groups';
import { useNotes } from '../../store/notes';

/** One <option> per group, nested ones named by their path, e.g. "Work / ML projects". */
export function GroupOptions() {
  const groups = useNotes((s) => s.groups);
  const rows = useMemo(() => groupTree(groups), [groups]);
  return (
    <>
      {rows.map(({ group }) => (
        <option key={group.id} value={group.id}>
          {groupPath(groups, group.id).join(' / ')}
        </option>
      ))}
    </>
  );
}
