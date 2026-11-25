/** The menus of workspaces: the switcher's, and the "move or copy to another workspace" entries added to page menus. */
import type { MenuItem } from '../../store/ui';
import { ask, confirmDanger, openMenu } from '../../store/ui';
import { GROUP_COLORS } from '../../types';
import { featureOn } from '../../store/features';
import { copyPagesToWorkspace, createWorkspace, deleteWorkspace, movePagesToWorkspace, renameWorkspace, setWorkspaceColor, switchWorkspace } from '../../store/workspaces';
import { createGroup, get } from '../../store/notes';
import { captureTo } from '../../store/capture';
import { copyPages, cutPages } from '../../store/pageClipboard';
import { openTodayAll } from '../../store/todayAll';
import { openFindAll } from '../../store/findAll';
import { listWorkspaces, MAIN, STARTERS } from '../../lib/workspaces';

const all = () => listWorkspaces(get().workspaces, get().mainName);
const openId = () => get().workspace ?? MAIN;

/** Asks for a thought and drops it into a workspace's Inbox page (the open one when none is given), without leaving what you are doing. */
export async function quickCaptureFlow(workspace = openId()): Promise<void> {
  const text = await ask({ title: `Quick note to ${all().find((w) => w.id === workspace)?.name ?? 'Inbox'}`, okLabel: 'Add to Inbox', placeholder: 'A thought, a to-do, a link…', text: 'It is added as a sticky note on the Inbox page of that workspace (made the first time).' });
  if (text !== null) await captureTo(workspace, text);
}

/** Asks for a name and makes the workspace, then opens it. */
export async function newWorkspaceFlow(): Promise<void> {
  const name = await ask({
    title: 'New workspace',
    okLabel: 'Create workspace',
    placeholder: 'For example: Student, Content creator',
    text: 'A separate desk inside the same app and storage: its own pages, groups, cards and journal. You can move or link pages between workspaces any time.',
  });
  if (name === null || !name.trim()) return;
  await switchWorkspace(createWorkspace(name).id);
  // Offered once, right away; closing the menu means an empty workspace.
  const anchor = document.querySelector<HTMLElement>('.ws-switch');
  if (anchor) {
    openMenu(anchor, [
      { heading: 'Start with some groups?' },
      ...STARTERS.map((s): MenuItem => ({ label: s.label, action: () => s.groups.forEach((g) => createGroup(g)) })),
      { label: 'No, start empty', action: () => {} },
    ]);
  }
}

/** The switcher's menu: every workspace (with how many pages), and the ways to make, rename, colour and delete. */
export function openWorkspaceMenu(anchor: HTMLElement, counts: Record<string, number>): void {
  const open = openId();
  const here = all().find((w) => w.id === open);
  const items: MenuItem[] = [
    { heading: 'Workspaces' },
    ...all().map((w) => ({ label: `${w.name}  (${counts[w.id] ?? 0})`, check: w.id === open, dot: w.color, action: () => void switchWorkspace(w.id) })),
    { label: 'New workspace…', action: () => void newWorkspaceFlow() },
    { label: 'Quick note to this workspace…', action: () => void quickCaptureFlow() },
    { label: 'Find in every workspace…', action: () => openFindAll() },
    { label: 'Today in every workspace…', action: () => void openTodayAll() },
    { separator: true },
    {
      label: 'Rename this workspace…',
      action: async () => {
        const v = await ask({ title: 'Rename workspace', initial: here?.name ?? '', okLabel: 'Rename', placeholder: 'Workspace name' });
        if (v?.trim()) renameWorkspace(open, v);
      },
    },
    ...(open !== MAIN && here
      ? [
          { swatches: true as const, title: 'Colour', current: here.color, pick: (c: (typeof GROUP_COLORS)[number]) => setWorkspaceColor(open, c) },
          {
            label: 'Delete this workspace…',
            danger: true,
            action: async () => {
              const n = counts[open] ?? 0;
              const ok = await confirmDanger(`Delete “${here.name}”?`, `Nothing is lost: its ${n === 1 ? 'page' : 'pages'}, groups and card folders move to ${all()[0].name}.`, 'Delete workspace');
              if (ok) await deleteWorkspace(open);
            },
          },
        ]
      : []),
  ];
  openMenu(anchor, items);
}

/** "Move to / Copy to" another workspace for these pages: nothing when the feature is off or there is no other workspace yet. */
export function workspaceMoveItems(ids: string[], after?: () => void): MenuItem[] {
  if (!featureOn('workspaces') || !ids.length) return [];
  const others = all().filter((w) => w.id !== openId());
  if (!others.length) return [];
  const done = (n: number) => n > 0 && after?.();
  const cards = ids.every((id) => get().pages[id]?.kind === 'card');
  const noun = cards ? 'card' : 'page';
  return [
    { heading: 'Workspaces' },
    { label: `Copy ${noun}${ids.length > 1 ? 's' : ''}  (to paste in another workspace)`, icon: 'copy', action: () => copyPages(ids) },
    { label: `Cut ${noun}${ids.length > 1 ? 's' : ''}  (to paste in another workspace)`, icon: 'scissors', action: () => cutPages(ids) },
    ...others.map((w): MenuItem => ({ label: `Move to ${w.name}`, dot: w.color, action: () => void movePagesToWorkspace(ids, w.id).then(done) })),
    ...others.map((w): MenuItem => ({ label: `Copy to ${w.name}`, dot: w.color, action: () => void copyPagesToWorkspace(ids, w.id).then(done) })),
    { separator: true },
  ];
}
