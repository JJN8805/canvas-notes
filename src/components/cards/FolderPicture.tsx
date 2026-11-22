import type { Group } from '../../types';
import { useImageUrl } from '../../lib/useImageUrl';
import { Picture } from '../blocks/Picture';

/** The picture of a card folder or section: `banner` across the top of it, or `thumb` as a small square in a heading. Nothing when it has none. */
export function FolderPicture({ folder, kind }: { folder: Group; kind: 'banner' | 'thumb' }) {
  const url = useImageUrl(folder.cover ?? '');
  if (!folder.cover || !url) return null;
  return (
    <span className={`folder-pic ${kind}`}>
      <Picture url={url} alt={kind === 'banner' ? `Picture of ${folder.name}` : ''} play="never" />
    </span>
  );
}
