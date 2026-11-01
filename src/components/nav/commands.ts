import { currentRoute, navigate } from '../../lib/route';
import { dateKey } from '../../lib/daily';
import { isDarkTheme } from '../../lib/settings';
import { goToDay } from '../ui/Calendar';
import { createGroup, getStorage, redo, setFilter, undo, useNotes } from '../../store/notes';
import { openNav } from '../../store/nav';
import { openTemplatePicker } from '../../store/picker';
import { openSettings } from '../../store/settingsUi';
import { setTheme, usePrefs } from '../../store/prefs';
import { ask } from '../../store/ui';
import { MOD_LABEL } from '../../lib/util';

export interface Command {
  id: string;
  title: string;
  /** Shortcut shown on the right. */
  keys?: string;
  run: () => void;
}

/** What the command palette offers right now (some commands only make sense on a page). */
export function buildCommands(): Command[] {
  const route = currentRoute();
  const onPage = route.name === 'page' ? route.id : null;
  const list: Command[] = [
    { id: 'new-page', title: 'New page', run: openTemplatePicker },
    { id: 'today', title: 'Open today’s page', keys: 'Ctrl+Alt+D', run: () => goToDay(dateKey()) },
    { id: 'switcher', title: 'Open quick switcher', keys: `${MOD_LABEL}+O`, run: () => openNav('switcher') },
    { id: 'graph', title: 'Open graph view', run: () => openNav('graph') },
    {
      id: 'library',
      title: 'Go to library',
      run: () => {
        setFilter({ kind: 'all' });
        navigate({ name: 'library' });
      },
    },
    {
      id: 'new-group',
      title: 'New group',
      run: async () => {
        const name = await ask({ title: 'New group', okLabel: 'Create group', placeholder: 'Group name' });
        if (name?.trim()) createGroup(name);
      },
    },
    { id: 'settings', title: 'Open settings', run: openSettings },
    {
      id: 'theme',
      title: 'Toggle light / dark theme',
      run: () => {
        const dark = isDarkTheme(usePrefs.getState().theme, window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
        setTheme(dark ? 'light' : 'dark', getStorage());
      },
    },
  ];
  if (onPage && useNotes.getState().pages[onPage]) {
    list.push(
      { id: 'outline', title: 'Show outline and links of this page', run: () => openNav('outline') },
      { id: 'undo', title: 'Undo', keys: `${MOD_LABEL}+Z`, run: () => void undo(onPage) },
      { id: 'redo', title: 'Redo', keys: `${MOD_LABEL}+Shift+Z`, run: () => void redo(onPage) },
    );
  }
  return list;
}
