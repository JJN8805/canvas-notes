import type { Group } from '../types';

export interface TreeRow {
  group: Group;
  depth: number;
  hasChildren: boolean;
}

/**
 * The parent each group is actually shown under. A parent that no longer
 * exists counts as "top level". If parents form a loop (possible when two
 * devices move groups into each other before syncing), the loop member that
 * comes first in the list is lifted to the top level and the others keep
 * their nesting, so every group always stays reachable.
 */
export function effectiveParents(groups: Group[]): Map<string, string | null> {
  const ids = new Set(groups.map((g) => g.id));
  const parent = new Map<string, string | null>(groups.map((g) => [g.id, g.parentId && ids.has(g.parentId) ? g.parentId : null]));
  for (const g of groups) {
    const seen = new Set<string>();
    let cur = parent.get(g.id) ?? null;
    while (cur) {
      if (cur === g.id) {
        parent.set(g.id, null); // g is the first loop member we reached: cut here
        break;
      }
      if (seen.has(cur)) break; // a loop above g that doesn't include g: cut when its own member comes up
      seen.add(cur);
      cur = parent.get(cur) ?? null;
    }
  }
  return parent;
}

/** Groups in display order (each followed by its subgroups), with depth. Collapsed groups hide their subgroups. */
export function groupTree(groups: Group[], collapsed: ReadonlySet<string> = new Set()): TreeRow[] {
  const parents = effectiveParents(groups);
  const children = new Map<string | null, Group[]>();
  for (const g of groups) {
    const p = parents.get(g.id) ?? null;
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(g);
  }
  const rows: TreeRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const g of children.get(parent) ?? []) {
      const kids = children.get(g.id) ?? [];
      rows.push({ group: g, depth, hasChildren: kids.length > 0 });
      if (!collapsed.has(g.id)) walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** The group and all groups nested inside it. */
export function withDescendants(groups: Group[], id: string): Set<string> {
  const parents = effectiveParents(groups);
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) {
      const p = parents.get(g.id);
      if (p && out.has(p) && !out.has(g.id)) {
        out.add(g.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Names from the top group down to this one, e.g. ["Work", "ML projects"]. */
export function groupPath(groups: Group[], id: string): string[] {
  const parents = effectiveParents(groups);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const path: string[] = [];
  let cur: string | null | undefined = id;
  while (cur && byId.has(cur) && path.length < 50) {
    path.unshift(byId.get(cur)!.name);
    cur = parents.get(cur);
  }
  return path;
}

/** Groups `id` may be moved into: anything except itself and its own subgroups. */
export function validParents(groups: Group[], id: string): Group[] {
  const blocked = withDescendants(groups, id);
  return groups.filter((g) => !blocked.has(g.id));
}
