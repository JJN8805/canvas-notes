/** Putting the storage report into words (pure), for Settings → Data → Storage. */
import type { StorageReport } from '../storage/types';
import { formatSize } from './media';

export interface ReportLine {
  label: string;
  /** What it takes now. */
  value: string;
  /** What sharing saved, or null when nothing was saved there. */
  saved: string | null;
  /** One sentence saying what is shared. */
  note: string;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** The lines of the Storage section. A line says how much is saved only when something really is. */
export function reportLines(r: StorageReport): ReportLine[] {
  const fileSaved = r.fileBytesIfCopied - r.fileBytes;
  const versionSaved = r.versionBytesIfCopied - r.versionBytes;
  return [
    {
      label: 'Pages',
      value: formatSize(r.pageBytes),
      saved: null,
      note: `${plural(r.pages, 'page')}, counting templates and cards. A page keeps its own boxes in one piece, so it opens and syncs as it is.`,
    },
    {
      label: 'Pictures and files',
      value: formatSize(r.fileBytes),
      saved: fileSaved > 0 ? formatSize(fileSaved) : null,
      note:
        r.fileUses === r.files
          ? `${plural(r.files, 'file')} kept. A picture you add again is not stored again.`
          : `${plural(r.fileUses, 'name')} for ${plural(r.files, 'distinct file')}: copies of the same picture share one file.`,
    },
    {
      label: 'Page history',
      value: formatSize(r.versionBytes),
      saved: versionSaved > 0 ? formatSize(versionSaved) : null,
      note:
        r.versions === 0
          ? 'No saved versions yet.'
          : `${plural(r.versions, 'saved version')} made of ${plural(r.historyBoxes, 'distinct box', 'distinct boxes')}: a box that did not change is kept once, not once per version.`,
    },
  ];
}

/** How much less room everything takes than if every copy were kept, as a whole percentage (0 when nothing is shared). */
export function savedPercent(r: StorageReport): number {
  const copied = r.pageBytes + r.fileBytesIfCopied + r.versionBytesIfCopied;
  const kept = r.pageBytes + r.fileBytes + r.versionBytes;
  return copied > 0 && kept < copied ? Math.round(((copied - kept) / copied) * 100) : 0;
}
