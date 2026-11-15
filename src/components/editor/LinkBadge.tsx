import type { Block } from '../../types';
import { linksOf, resolveLink } from '../../lib/boxLinks';
import { followLink, openLinkDialog } from '../../store/boxLinks';
import { useNotes } from '../../store/notes';
import { openMenu } from '../../store/ui';
import { Icon } from '../ui/Icon';

/** A small link mark on a box that has links; click it for the list (each entry opens what it leads to). */
export function LinkBadge({ block, pageId }: { block: Block; pageId: string }) {
  const links = linksOf(block);
  const pages = useNotes((s) => (links.length ? s.pages : null));
  if (!links.length || !pages) return null;
  return (
    <button
      className="link-badge"
      aria-label={`${links.length} link${links.length === 1 ? '' : 's'}`}
      title={links.map((l) => resolveLink(l, pages).label).join('\n')}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        openMenu(e.currentTarget, [
          { heading: 'Go to' },
          ...links.map((l) => {
            const r = resolveLink(l, pages);
            return { label: r.broken === 'page' ? 'Missing page' : r.label + (r.broken ? ' (missing box)' : ''), action: () => followLink(l) };
          }),
          { separator: true },
          { label: 'Edit links…', action: () => openLinkDialog(pageId, block.id) },
        ]);
      }}
    >
      <Icon name="link" size={11} />
      {links.length > 1 && <span>{links.length}</span>}
    </button>
  );
}
