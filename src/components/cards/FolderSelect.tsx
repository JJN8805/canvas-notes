import { useMemo } from 'react';
import { folderChoices } from '../../lib/cardFolders';
import { useNotes } from '../../store/notes';

/** One <option> per card folder and section, each named by its path, e.g. "Plants / Indoor / Ferns". */
export function FolderOptions() {
  const folders = useNotes((s) => s.cardFolders);
  const rows = useMemo(() => folderChoices(folders), [folders]);
  return (
    <>
      {rows.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </>
  );
}
