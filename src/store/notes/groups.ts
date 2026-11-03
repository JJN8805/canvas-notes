import { Filter, Group, GroupColor, SortKey, GROUP_COLORS } from '../../types';
import { newId } from '../../lib/util';
import { history } from '../history';
import { effectiveParents, validParents } from '../../lib/groups';
import { get, getStorage, set } from './state';
import { scheduleGroupsSave } from './save';
import { setPageGroup } from './pages';

/* ------------------------------------------------------------------ */
/* Groups & library view                                               */
/* ------------------------------------------------------------------ */

export function createGroup(name: string, parentId: string | null = null): Group {
  const groups = get().groups;
  const parent = parentId ? groups.find((g) => g.id === parentId) : undefined;
  // A subgroup starts with its parent's colour; a new top-level group gets an unused one.
  const used = groups.map((g) => g.color);
  const color: GroupColor =
    parent?.color ?? GROUP_COLORS.find((c) => !used.includes(c)) ?? GROUP_COLORS[groups.length % GROUP_COLORS.length];
  const g: Group = { id: newId(), name: name.trim().slice(0, 60), color, parentId: parent ? parent.id : null };
  set((s) => {
    s.groups.push(g);
    if (parent) s.collapsed = s.collapsed.filter((id) => id !== parent.id); // show the new subgroup
  });
  scheduleGroupsSave();
  return g;
}

export function updateGroup(id: string, patch: Partial<Pick<Group, 'name' | 'color'>>) {
  set((s) => {
    const g = s.groups.find((x) => x.id === id);
    if (g) Object.assign(g, patch);
  });
  scheduleGroupsSave();
}

/** Moves a group (with everything inside it) into another group, or to the top level. */
export function moveGroup(id: string, parentId: string | null): boolean {
  if (parentId && !validParents(get().groups, id).some((g) => g.id === parentId)) return false;
  set((s) => {
    const g = s.groups.find((x) => x.id === id);
    if (g) g.parentId = parentId;
    if (parentId) s.collapsed = s.collapsed.filter((x) => x !== parentId);
  });
  scheduleGroupsSave();
  return true;
}

/**
 * Deletes one group. Nothing inside it is lost: its subgroups and pages move
 * up into its parent group (or to the top level / Ungrouped).
 */
export function deleteGroup(id: string) {
  const groups = get().groups;
  const parentId = effectiveParents(groups).get(id) ?? null;
  set((s) => {
    for (const g of s.groups) if (g.parentId === id) g.parentId = parentId;
    s.groups = s.groups.filter((g) => g.id !== id);
    if (s.filter.kind === 'group' && s.filter.id === id) s.filter = parentId ? { kind: 'group', id: parentId } : { kind: 'groups' };
  });
  for (const p of Object.values(get().pages)) if (p.groupId === id) setPageGroup(p.id, parentId);
  scheduleGroupsSave();
}

export function toggleCollapsed(id: string) {
  set((s) => {
    s.collapsed = s.collapsed.includes(id) ? s.collapsed.filter((x) => x !== id) : [...s.collapsed, id];
  });
  void getStorage().setSetting('ui.collapsedGroups', JSON.stringify(get().collapsed)).catch(() => {});
}

export function setFilter(filter: Filter) {
  set((s) => {
    s.filter = filter;
  });
}
export function setQuery(query: string) {
  set((s) => {
    s.query = query;
  });
}
export function setSort(sort: SortKey) {
  set((s) => {
    s.sort = sort;
  });
}

export { history };
