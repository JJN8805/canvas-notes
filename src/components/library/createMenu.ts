/**
 * The one "New" menu: everything the app can make, grouped the way people think about it (a note, a card, something to write or build),
 * so a feature is found by asking "what do I want to make?" instead of by knowing which screen it lives on. Gated by the same features
 * as the screens, so a copy that leaves something out never offers it.
 */
import { navigate } from '../../lib/route';
import { isFeatureOn } from '../../lib/features';
import { OFFICE_LABEL, type OfficeApp } from '../../lib/office/app';
import type { MenuItem } from '../../store/ui';
import type { IconName } from '../ui/Icon';
import { ask, openMenu } from '../../store/ui';
import { featureOn, useFeatures } from '../../store/features';
import { createCard } from '../../store/cards';
import { createGroup, setFilter } from '../../store/notes';
import { openJournal } from '../../store/journal';
import { createOfficePage } from '../../store/office';
import { useAddons } from '../../addons/store';
import { openNewPage } from './shared';

const STUDIO: { app: OfficeApp; starter: string; icon: IconName }[] = [
  { app: 'doc', starter: 'doc-blank', icon: 'edit' },
  { app: 'sheet', starter: 'sheet-blank', icon: 'table' },
  { app: 'slides', starter: 'slides-blank', icon: 'frame' },
  { app: 'script', starter: 'script-screenplay', icon: 'book' },
];

const makeStudio = (app: OfficeApp, starter: string) => {
  const page = createOfficePage(app, starter);
  if (page) navigate({ name: 'page', id: page.id });
};

/** What can be made right now, as menu entries. */
export function createItems(): MenuItem[] {
  const disabled = useFeatures.getState().disabled;
  const studioOn = useAddons.getState().enabled.includes('office');
  const items: MenuItem[] = [];
  if (featureOn('canvas')) items.push({ label: 'Page', icon: 'pages', action: openNewPage });
  if (featureOn('cards')) {
    items.push({
      label: 'Card',
      icon: 'card',
      action: () => {
        setFilter({ kind: 'cards' });
        navigate({ name: 'library' });
        createCard();
      },
    });
  }
  if (featureOn('journal')) items.push({ label: 'Today in the journal', icon: 'book', action: () => openJournal() });
  const studio = studioOn ? STUDIO.filter((s) => isFeatureOn(disabled, s.app)) : [];
  if (studio.length) {
    items.push({ separator: true }, { heading: 'Write or build' });
    for (const s of studio) items.push({ label: OFFICE_LABEL[s.app], icon: s.icon, action: () => makeStudio(s.app, s.starter) });
    items.push({ label: 'More starters…', icon: 'template', action: () => setFilter({ kind: 'addon', id: 'office' }) });
  }
  if (featureOn('groups')) {
    items.push({ separator: true }, {
      label: 'Group',
      icon: 'folder',
      action: async () => {
        const name = await ask({ title: 'New group', okLabel: 'Create group', placeholder: 'Group name' });
        if (name?.trim()) createGroup(name);
      },
    });
  }
  return items;
}

/** Opens the New menu under `anchor`. Does nothing useful with one choice, so the caller can use `createCount` to skip the menu. */
export const openCreateMenu = (anchor: HTMLElement) => openMenu(anchor, createItems());
export const createCount = () => createItems().filter((i) => 'action' in i).length;
