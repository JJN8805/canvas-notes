import { currentRoute, navigate } from '../../lib/route';
import { dateKey } from '../../lib/daily';
import { isDarkTheme } from '../../lib/settings';
import { openJournal } from '../../store/journal';
import { createCard } from '../../store/cards';
import { pinPage } from '../../widgets';
import { widgetsAvailableNow } from '../../widgets/host';
import { createGroup, getStorage, redo, setFilter, undo, useNotes } from '../../store/notes';
import { openNav } from '../../store/nav';
import { addonCommands } from '../../addons/store';
import { openTemplatePicker } from '../../store/picker';
import { openSettings } from '../../store/settingsUi';
import { setPalette, setTheme, usePrefs } from '../../store/prefs';
import { ask } from '../../store/ui';
import { activeTheme } from '../../lib/themes';
import { MOD_LABEL } from '../../lib/util';
import type { IconName } from '../ui/Icon';

export interface Command {
  id: string;
  title: string;
  /** Shortcut shown on the right. */
  keys?: string;
  icon?: IconName;
  run: () => void;
}

/** What the command palette offers right now (some commands only make sense on a page). */
export function buildCommands(): Command[] {
  const route = currentRoute();
  const onPage = route.name === 'page' ? route.id : null;
  const list: Command[] = [
    { id: 'new-page', icon: 'plus', title: 'New page', run: openTemplatePicker },
    { id: 'today', icon: 'today', title: 'Open today in the journal', keys: 'Ctrl+Alt+D', run: () => openJournal(dateKey()) },
    { id: 'journal', icon: 'book', title: 'Open the journal', run: () => openJournal() },
    { id: 'switcher', icon: 'search', title: 'Open quick switcher', keys: `${MOD_LABEL}+O`, run: () => openNav('switcher') },
    { id: 'graph', icon: 'graph', title: 'Open graph view', run: () => openNav('graph') },
    {
      id: 'library',
      icon: 'pages',
      title: 'Go to library',
      run: () => {
        setFilter({ kind: 'all' });
        navigate({ name: 'library' });
      },
    },
    {
      id: 'groups',
      icon: 'folder',
      title: 'Browse groups',
      run: () => {
        setFilter({ kind: 'groups' });
        navigate({ name: 'library' });
      },
    },
    {
      id: 'tags',
      icon: 'tag',
      title: 'Browse tags',
      run: () => {
        setFilter({ kind: 'tags' });
        navigate({ name: 'library' });
      },
    },
    {
      id: 'cards',
      icon: 'card',
      title: 'Browse cards',
      run: () => {
        setFilter({ kind: 'cards' });
        navigate({ name: 'library' });
      },
    },
    {
      id: 'new-card',
      icon: 'card',
      title: 'New card',
      run: () => {
        setFilter({ kind: 'cards' });
        navigate({ name: 'library' });
        createCard();
      },
    },
    {
      id: 'new-group',
      icon: 'folder',
      title: 'New group',
      run: async () => {
        const name = await ask({ title: 'New group', okLabel: 'Create group', placeholder: 'Group name' });
        if (name?.trim()) createGroup(name);
      },
    },
    { id: 'settings', icon: 'settings', title: 'Open settings', run: openSettings },
    {
      id: 'theme',
      icon: 'palette',
      title: 'Toggle light / dark theme',
      run: () => {
        const { theme, palette, custom } = usePrefs.getState();
        const colors = activeTheme(palette, custom);
        const dark = colors ? colors.base === 'dark' : isDarkTheme(theme, window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
        // A colour theme is light or dark by itself, so switching goes back to the default look first.
        if (colors) setPalette('default', getStorage());
        setTheme(dark ? 'light' : 'dark', getStorage());
      },
    },
  ];
  if (onPage && useNotes.getState().pages[onPage]) {
    list.push(
      ...(widgetsAvailableNow() ? [{ id: 'pin-page', icon: 'pin' as const, title: 'Pin this page to the desktop', run: () => void pinPage(useNotes.getState().pages[onPage]) }] : []),
      { id: 'outline', icon: 'outline', title: 'Show outline and links of this page', run: () => openNav('outline') },
      { id: 'undo', icon: 'undo', title: 'Undo', keys: `${MOD_LABEL}+Z`, run: () => void undo(onPage) },
      { id: 'redo', icon: 'redo', title: 'Redo', keys: `${MOD_LABEL}+Shift+Z`, run: () => void redo(onPage) },
    );
  }
  return [...list, ...addonCommands(onPage)];
}
