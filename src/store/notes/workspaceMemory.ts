import type { Page } from '../../types';
import type { PageStub } from '../../lib/workspaces';
import { workspaceOf } from '../../lib/workspaces';

/** The setting that holds what Main is called (a per-device name; the workspaces you make sync as groups). */
export const MAIN_NAME_KEY = 'workspace.mainName';
const ACTIVE_KEY = 'ui.workspace';

/** The workspace that was open last time on this device (localStorage; unreadable = none, so Main opens). */
export function savedWorkspace(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
export function rememberWorkspace(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* not remembered: Main opens next time */
  }
}

const LAST_KEY = 'ui.workspace.last.';
/** The page that was open when you last left a workspace (per device), so coming back reopens it. */
export function rememberLastPage(workspace: string, pageId: string | null): void {
  try {
    if (pageId) window.localStorage.setItem(LAST_KEY + (workspace || 'main'), pageId);
    else window.localStorage.removeItem(LAST_KEY + (workspace || 'main'));
  } catch {
    /* not remembered */
  }
}
export function lastPageOf(workspace: string): string | null {
  try {
    return window.localStorage.getItem(LAST_KEY + (workspace || 'main'));
  } catch {
    return null;
  }
}

export const stubOf = (p: Page): PageStub => ({
  id: p.id,
  title: p.title,
  kind: p.kind ?? 'page',
  workspace: workspaceOf(p),
  ...(p.icon ? { icon: p.icon } : {}),
  ...(p.archived ? { archived: true } : {}),
  updated: p.updated,
});
