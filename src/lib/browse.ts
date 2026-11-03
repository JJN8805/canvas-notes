/** What the Groups and Tags pages list, and how their search works. */
import type { Group, Page } from '../types';
import { effectiveParents, groupPath, withDescendants } from './groups';

export interface GroupSummary {
  group: Group;
  /** Names from the top group down to this one. */
  path: string[];
  /** The group this one is shown under (null = top level). */
  parentId: string | null;
  /** Pages in the group, including those in its subgroups. */
  pages: number;
  /** Subgroups directly inside it. */
  subgroups: number;
}

/** Every group with its place in the tree and page count, in the order the groups are stored. */
export function groupSummaries(groups: Group[], pages: Page[]): GroupSummary[] {
  const parents = effectiveParents(groups);
  const kids = new Map<string, number>();
  for (const p of parents.values()) if (p) kids.set(p, (kids.get(p) ?? 0) + 1);
  return groups.map((group) => {
    const inside = withDescendants(groups, group.id);
    return {
      group,
      path: groupPath(groups, group.id),
      parentId: parents.get(group.id) ?? null,
      pages: pages.filter((p) => p.groupId && inside.has(p.groupId)).length,
      subgroups: kids.get(group.id) ?? 0,
    };
  });
}

/** The groups directly inside `parentId` (null = top level), by name. */
export const childSummaries = (all: GroupSummary[], parentId: string | null): GroupSummary[] =>
  all.filter((s) => s.parentId === parentId).sort((a, b) => a.group.name.localeCompare(b.group.name));

/** The groups above this one, from the top down (not including the group itself). */
export function groupAncestors(groups: Group[], id: string): Group[] {
  const parents = effectiveParents(groups);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out: Group[] = [];
  let cur = parents.get(id) ?? null;
  while (cur && byId.has(cur) && out.length < 50) {
    out.unshift(byId.get(cur)!);
    cur = parents.get(cur) ?? null;
  }
  return out;
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** Groups at any depth whose name or place ("Work / ML projects") contains every word of the query, best name matches first. */
export function searchGroups(all: GroupSummary[], query: string): GroupSummary[] {
  const w = words(query);
  if (!w.length) return childSummaries(all, null);
  const hits = all.filter((s) => {
    const hay = s.path.join(' / ').toLowerCase();
    return w.every((x) => hay.includes(x));
  });
  const nameHit = (s: GroupSummary) => (w.every((x) => s.group.name.toLowerCase().includes(x)) ? 0 : 1);
  return hits.sort((a, b) => nameHit(a) - nameHit(b) || a.group.name.localeCompare(b.group.name));
}

export interface TagSummary {
  tag: string;
  count: number;
}

export function tagSummaries(pages: Page[]): TagSummary[] {
  const m = new Map<string, number>();
  for (const p of pages) for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([tag, count]) => ({ tag, count }));
}

export type TagSort = 'name' | 'count';

/** Tags containing every word of the query (a leading # is ignored), sorted by name or by how many pages use them. */
export function searchTags(all: TagSummary[], query: string, sort: TagSort): TagSummary[] {
  const w = words(query.replace(/#/g, ' '));
  const out = all.filter((t) => w.every((x) => t.tag.toLowerCase().includes(x)));
  return out.sort((a, b) => (sort === 'count' ? b.count - a.count : 0) || a.tag.localeCompare(b.tag));
}
