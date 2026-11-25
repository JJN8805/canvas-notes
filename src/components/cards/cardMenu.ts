import type { Page } from '../../types';
import { cardLabel } from '../../lib/cards';
import { canArchive } from '../../lib/pages';
import { archivePage } from '../../store/archive';
import { deletePage } from '../../store/notes';
import { featureOn } from '../../store/features';
import { confirmDanger, openMenu, openMenuAt } from '../../store/ui';
import { workspaceMoveItems } from '../library/workspaceMenu';
import type { MenuItem } from '../../store/ui';

/** What can be done with one card: open it, copy or move it to another workspace, archive it, delete it. */
export function cardMenuItems(card: Page, open: () => void): MenuItem[] {
  return [
    { label: 'Open card', action: open },
    ...workspaceMoveItems(canArchive(card) ? [card.id] : []),
    ...(featureOn('archive') && canArchive(card) ? [{ label: 'Archive card', action: () => void archivePage(card.id) }] : []),
    { label: 'Delete card', danger: true, action: () => void confirmDanger(`Delete “${cardLabel(card)}”?`, 'The card goes to Trash, where you can restore it.', 'Delete card').then((ok) => ok && void deletePage(card.id)) },
  ];
}

export const openCardMenu = (anchor: HTMLElement, card: Page, open: () => void) => openMenu(anchor, cardMenuItems(card, open));
export const openCardMenuAt = (x: number, y: number, anchor: HTMLElement, card: Page, open: () => void) => openMenuAt(anchor, x, y, cardMenuItems(card, open));
