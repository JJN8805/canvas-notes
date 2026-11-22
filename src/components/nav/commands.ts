import { COARSE } from '../../lib/touch';
import { currentRoute, navigate } from '../../lib/route';
import { dateKey } from '../../lib/daily';
import { isDarkTheme } from '../../lib/settings';
import { openJournal, useJournal } from '../../store/journal';
import { openWeekly } from '../../store/weekly';
import { createCard } from '../../store/cards';
import { pinPage } from '../../widgets';
import { widgetsAvailableNow } from '../../widgets/host';
import { createGroup, getStorage, redo, setFilter, undo, useNotes } from '../../store/notes';
import { toggleFocusMode } from '../../store/focusMode';
import { openNav } from '../../store/nav';
import { openTidy } from '../../store/tidy';
import { openShortcuts } from '../../store/shortcutsUi';
import { addonCommands } from '../../addons/store';
import { openSettings } from '../../store/settingsUi';
import { setPalette, setTheme, usePrefs } from '../../store/prefs';
import { ask } from '../../store/ui';
import { activeTheme } from '../../lib/themes';
import { MOD_LABEL } from '../../lib/util';
import type { IconName } from '../ui/Icon';
import type { FeatureId } from '../../lib/features';
import { featureOn } from '../../store/features';
import { archivePage, restorePage } from '../../store/archive';
import { canArchive, isArchived } from '../../lib/pages';
import { openNewPage } from '../library/shared';
import { pageApp } from '../../lib/office/app';
import { listWorkspaces } from '../../lib/workspaces';
import { openTodayAll } from '../../store/todayAll';
import { openFindAll } from '../../store/findAll';
import { switchWorkspace } from '../../store/workspaces';
import { newWorkspaceFlow, quickCaptureFlow } from '../library/workspaceMenu';

/** "Switch to X" for each other workspace, and a way to make one. */
function workspaceCommands(): Command[] {
  const st = useNotes.getState();
  const open = st.workspace ?? '';
  const others = listWorkspaces(st.workspaces, st.mainName).filter((w) => w.id !== open);
  return [
    ...others.map((w): Command => ({ id: `workspace-${w.id || 'main'}`, feature: 'workspaces', icon: 'pages', title: `Switch to workspace: ${w.name}`, run: () => void switchWorkspace(w.id) })),
    ...listWorkspaces(st.workspaces, st.mainName).map((w): Command => ({ id: `capture-${w.id || 'main'}`, feature: 'workspaces', icon: 'plus', title: `Quick note to ${w.name}…`, run: () => void quickCaptureFlow(w.id) })),
    { id: 'workspace-find', feature: 'workspaces', icon: 'search', title: 'Find in every workspace…', run: () => openFindAll() },
    { id: 'workspace-today', feature: 'workspaces', icon: 'today', title: 'Today in every workspace', run: () => void openTodayAll() },
    { id: 'workspace-new', feature: 'workspaces', icon: 'plus', title: 'New workspace…', run: () => void newWorkspaceFlow() },
  ];
}

export interface Command {
  id: string;
  title: string;
  /** The feature this belongs to: with it switched off the command is not offered. */
  feature?: FeatureId;
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
    { id: 'new-page', icon: 'plus', title: 'New page', run: openNewPage },
    { id: 'today', feature: 'journal', icon: 'today', title: 'Open today in the journal', keys: 'Ctrl+Alt+D', run: () => openJournal(dateKey()) },
    { id: 'journal', feature: 'journal', icon: 'book', title: 'Open the journal', run: () => openJournal() },
    { id: 'weekly', feature: 'journal', icon: 'calendar', title: 'Review my week…', run: () => openWeekly(route.name === 'library' ? useJournal.getState().date : dateKey()) },
    ...(COARSE ? [] : [{ id: 'shortcuts', icon: 'keyboard' as const, title: 'Keyboard shortcuts', keys: '?', run: openShortcuts }]),
    { id: 'switcher', icon: 'search', title: 'Open quick switcher', keys: `${MOD_LABEL}+O`, run: () => openNav('switcher') },
    { id: 'archive', feature: 'archive', icon: 'archive', title: 'Open the archive', run: () => { setFilter({ kind: 'archive' }); navigate({ name: 'library' }); } },
    ...workspaceCommands(),
    { id: 'graph', feature: 'graph', icon: 'graph', title: 'Open graph view', run: () => openNav('graph') },
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
      feature: 'groups',
      icon: 'folder',
      title: 'Browse groups',
      run: () => {
        setFilter({ kind: 'groups' });
        navigate({ name: 'library' });
      },
    },
    {
      id: 'tags',
      feature: 'tags',
      icon: 'tag',
      title: 'Browse tags',
      run: () => {
        setFilter({ kind: 'tags' });
        navigate({ name: 'library' });
      },
    },
    {
      id: 'cards',
      feature: 'cards',
      icon: 'card',
      title: 'Browse cards',
      run: () => {
        setFilter({ kind: 'cards' });
        navigate({ name: 'library' });
      },
    },
    {
      id: 'new-card',
      feature: 'cards',
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
      feature: 'groups',
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
      ...(widgetsAvailableNow() ? [{ id: 'pin-page', feature: 'widgets' as const, icon: 'pin' as const, title: 'Pin this page to the desktop', run: () => void pinPage(useNotes.getState().pages[onPage]) }] : []),
      { id: 'outline', icon: 'outline', title: 'Show outline and links of this page', run: () => openNav('outline') },
      ...(pageApp(useNotes.getState().pages[onPage]) ? [] : [{ id: 'space', feature: 'space' as const, icon: 'graph' as const, title: 'Open this page in 3D', run: () => openNav('space') }]),
      { id: 'focus', feature: 'canvas' as const, icon: 'frame' as const, title: 'Focus mode: hide everything but the page', keys: `${MOD_LABEL}+Shift+F`, run: () => toggleFocusMode() },
      ...(useNotes.getState().pages[onPage] && canArchive(useNotes.getState().pages[onPage])
        ? [isArchived(useNotes.getState().pages[onPage])
            ? { id: 'restore-page', feature: 'archive' as const, icon: 'archive' as const, title: 'Restore this page from the Archive', run: () => void restorePage(onPage) }
            : { id: 'archive-page', feature: 'archive' as const, icon: 'archive' as const, title: 'Archive this page', run: () => void (archivePage(onPage) && navigate({ name: 'library' })) }]
        : []),
      { id: 'tidy', icon: 'pages', title: 'Tidy this page…', run: () => openTidy(onPage) },
      { id: 'undo', icon: 'undo', title: 'Undo', keys: `${MOD_LABEL}+Z`, run: () => void undo(onPage) },
      { id: 'redo', icon: 'redo', title: 'Redo', keys: `${MOD_LABEL}+Shift+Z`, run: () => void redo(onPage) },
    );
  }
  return [...list, ...addonCommands(onPage)].filter((c) => !c.feature || featureOn(c.feature));
}
