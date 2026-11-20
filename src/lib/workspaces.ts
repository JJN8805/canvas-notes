/**
 * Workspaces: separate "desks" inside one library (say, Student and Content creator). Every page and every group (page group or card
 * folder) belongs to exactly one; the app shows one at a time. The pure rules live here.
 *
 * - `Page.workspace` / `Group.workspace`: the id of the workspace. Absent or '' = the **Main** workspace, so everything made before
 *   workspaces existed (and by older app versions, which ignore the field) is in Main and nothing had to be rewritten.
 * - The workspaces themselves are rows of the groups table with `scope: 'workspaces'` (name, colour, order), so they sync and back up
 *   through the same paths as every other group. Main is not a row: it always exists and cannot be deleted.
 * - Pages stay in the one database, the one picture store and the one backup; only what is shown and listed differs.
 */
import type { Group, GroupColor } from '../types';
import { isSafeId } from '../storage/validate';

/** The id of the Main workspace (the one that always exists). */
export const MAIN = '';
export const MAIN_NAME = 'Main';
const MAX_NAME = 60;

/** A workspace id as stored: '' (Main) or a safe id; anything else is Main. */
export const cleanWorkspaceId = (v: unknown): string => (typeof v === 'string' && isSafeId(v) ? v : MAIN);

/** The workspace something belongs to ('' = Main). */
export const workspaceOf = (x: { workspace?: string | null }): string => cleanWorkspaceId(x.workspace);

/** Whether something belongs to the workspace. */
export const inWorkspace = (x: { workspace?: string | null }, ws: string): boolean => workspaceOf(x) === ws;

/** A workspace's name as stored: one line, trimmed, not empty (Main's name when it is). */
export const cleanWorkspaceName = (v: unknown, fallback = MAIN_NAME): string => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
  return s || fallback;
};

export const isWorkspaceRow = (g: { scope?: string }): boolean => g.scope === 'workspaces';

export interface WorkspaceInfo {
  id: string;
  name: string;
  color: GroupColor;
}

/** Every workspace in order: Main first (named `mainName`), then the ones made, in the order they were made. */
export function listWorkspaces(rows: readonly Group[], mainName = MAIN_NAME, mainColor: GroupColor = 'ultra'): WorkspaceInfo[] {
  return [{ id: MAIN, name: cleanWorkspaceName(mainName), color: mainColor }, ...rows.filter(isWorkspaceRow).map((g) => ({ id: g.id, name: g.name, color: g.color }))];
}

/** The workspace to open: the remembered one if it still exists, otherwise Main. */
export const resolveActive = (saved: unknown, list: readonly { id: string }[]): string => {
  const id = cleanWorkspaceId(saved);
  return list.some((w) => w.id === id) ? id : MAIN;
};

/** A name for a new workspace that no other uses (case aside): "Name", then "Name 2", "Name 3"… */
export function uniqueName(wanted: string, taken: readonly string[]): string {
  const base = cleanWorkspaceName(wanted, 'Workspace');
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/**
 * Whether a page or group is loaded while `active` is open (`null` = everything, for windows that need every workspace).
 * Templates belong to no workspace: every workspace offers all of them (the ones shipped with the app, and the ones you saved).
 */
export const isInScope = (x: { workspace?: string | null; kind?: string | null }, active: string | null): boolean =>
  active === null || x.kind === 'template' || inWorkspace(x, active);

/** The pages and groups of one workspace (pure filter used when a workspace is opened). */
export function scopeTo<T extends { workspace?: string | null; kind?: string | null }>(items: readonly T[], active: string | null): T[] {
  return items.filter((x) => isInScope(x, active));
}

/** The groups table holds three kinds of rows; they are told apart here, and the ones of other workspaces are kept aside so saving never drops them. */
export interface GroupsSplit {
  workspaces: Group[];
  groups: Group[];
  cardFolders: Group[];
  /** Page groups and card folders of the workspaces that are not open: not shown, but saved back with the rest. */
  hiddenGroups: Group[];
  hiddenCardFolders: Group[];
}

export function splitGroups(all: readonly Group[], active: string | null): GroupsSplit {
  const out: GroupsSplit = { workspaces: [], groups: [], cardFolders: [], hiddenGroups: [], hiddenCardFolders: [] };
  for (const g of all) {
    if (isWorkspaceRow(g)) out.workspaces.push(g);
    else if (g.scope === 'cards') (isInScope(g, active) ? out.cardFolders : out.hiddenCardFolders).push(g);
    else (isInScope(g, active) ? out.groups : out.hiddenGroups).push(g);
  }
  return out;
}

/** Just enough of a page to list it, name its workspace and link to it, without reading its boxes. */
export interface PageStub {
  id: string;
  title: string;
  kind: string;
  workspace: string;
  icon?: string;
  archived?: boolean;
}

/** Every page of a workspace that is not open, grouped for a picker: the live (not archived) pages and cards of each other workspace. */
export function stubsByWorkspace(stubs: readonly PageStub[], active: string | null): Map<string, PageStub[]> {
  const out = new Map<string, PageStub[]>();
  for (const s of stubs) {
    if (s.kind === 'template' || s.archived || (active !== null && s.workspace === active)) continue;
    const list = out.get(s.workspace) ?? [];
    list.push(s);
    out.set(s.workspace, list);
  }
  for (const list of out.values()) list.sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'));
  return out;
}

/** Ctrl+Alt+1 … 9: the number of the workspace to open (1 = Main, 2 = the first one made …), or null for any other key. */
export function workspaceShortcut(e: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; repeat?: boolean }): number | null {
  const m = /^Digit([1-9])$/.exec(e.code);
  return m && e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && !e.repeat ? Number(m[1]) : null;
}

/** Ready-made groups to start a new workspace with (offered once, after it is made; none is the default). */
export const STARTERS: readonly { id: string; label: string; groups: readonly string[] }[] = [
  { id: 'student', label: 'Student: Courses, Assignments, Exams, Reading', groups: ['Courses', 'Assignments', 'Exams', 'Reading'] },
  { id: 'creator', label: 'Content creator: Ideas, Scripts, Production, Published', groups: ['Ideas', 'Scripts', 'Production', 'Published'] },
  { id: 'work', label: 'Work: Projects, Meetings, Reference', groups: ['Projects', 'Meetings', 'Reference'] },
];

/** Pages of other workspaces whose title has every word of the query (titles only: their boxes are not loaded). */
export function searchStubs(stubs: readonly PageStub[], query: string, limit = 8): PageStub[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return stubs
    .filter((s) => s.kind !== 'template' && !s.archived && words.every((w) => (s.title || 'Untitled').toLowerCase().includes(w)))
    .slice(0, limit);
}
