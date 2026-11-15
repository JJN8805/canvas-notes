/**
 * Card folders (pure). The Cards screen keeps its own tree, separate from the groups that hold pages: a *folder* at the top, and *sections*
 * inside it, to any depth. A card sits in one folder or section (`Page.groupId` holds its id), or in none ("Unfiled").
 */
import type { Group, GroupColor, Page } from '../types';
import { GROUP_COLORS } from '../types';
import { effectiveParents, groupPath, groupTree, validParents, withDescendants } from './groups';

/** What a place in the tree is called: the top level holds folders, everything inside them is a section. */
export const placeName = (depth: number) => (depth === 0 ? 'folder' : 'section');
export const placeNameCap = (depth: number) => (depth === 0 ? 'Folder' : 'Section');

/** Where the Cards screen is looking. */
export type Place = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'folder'; id: string };

export const placeKey = (p: Place) => (p.kind === 'folder' ? p.id : p.kind);

/** The ids of folders that exist. */
const idsOf = (folders: readonly Group[]) => new Set(folders.map((f) => f.id));

/** The folder a card is in, or null. A card pointing at something that is not a folder (a page group from before, or a deleted folder) is unfiled. */
export const folderOfCard = (card: Pick<Page, 'groupId'>, folders: readonly Group[]): string | null =>
  card.groupId && idsOf(folders).has(card.groupId) ? card.groupId : null;

/**
 * The cards at a place. For a folder, only the cards directly in it unless `nested` (then those in its sections too, however deep).
 */
export function cardsAt(cards: readonly Page[], folders: readonly Group[], place: Place, opts: { nested?: boolean } = {}): Page[] {
  if (place.kind === 'all') return [...cards];
  if (place.kind === 'unfiled') return cards.filter((c) => folderOfCard(c, folders) === null);
  const inside = opts.nested ? withDescendants([...folders], place.id) : new Set([place.id]);
  return cards.filter((c) => !!c.groupId && inside.has(c.groupId));
}

/** The sections directly inside a folder (or the folders at the top for null), in the order they were made or arranged. */
export const childrenOf = (folders: readonly Group[], parentId: string | null): Group[] => {
  const parents = effectiveParents([...folders]);
  return folders.filter((f) => (parents.get(f.id) ?? null) === parentId);
};

/** The order of the folders after moving one up or down among its neighbours; null when it is already at that end. */
export function reordered(folders: readonly Group[], id: string, dir: -1 | 1): Group[] | null {
  const f = folders.find((x) => x.id === id);
  if (!f) return null;
  const sibs = childrenOf(folders, (effectiveParents([...folders]).get(id) ?? null));
  const at = sibs.findIndex((x) => x.id === id);
  const other = sibs[at + dir];
  if (at < 0 || !other) return null;
  const out = [...folders];
  const i = out.findIndex((x) => x.id === id);
  const j = out.findIndex((x) => x.id === other.id);
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** How many cards each folder holds, counting those in the sections inside it. */
export function folderCounts(cards: readonly Page[], folders: readonly Group[]): Map<string, number> {
  const parents = effectiveParents([...folders]);
  const known = idsOf(folders);
  const out = new Map<string, number>(folders.map((f) => [f.id, 0]));
  for (const c of cards) {
    let cur: string | null | undefined = c.groupId && known.has(c.groupId) ? c.groupId : null;
    for (let guard = 0; cur && guard < 60; guard++) {
      out.set(cur, (out.get(cur) ?? 0) + 1);
      cur = parents.get(cur);
    }
  }
  return out;
}

/** From the top down to this place: ["Plants", "Indoor", "Ferns"]. Empty for a place that is not a folder. */
export function trailOf(folders: readonly Group[], id: string): Group[] {
  const parents = effectiveParents([...folders]);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: Group[] = [];
  for (let cur: string | null | undefined = id, guard = 0; cur && guard < 60; guard++) {
    const f = byId.get(cur);
    if (!f) break;
    out.unshift(f);
    cur = parents.get(cur);
  }
  return out;
}

export const depthOf = (folders: readonly Group[], id: string) => Math.max(0, trailOf(folders, id).length - 1);

export interface FolderChoice {
  id: string;
  /** "Plants / Indoor / Ferns" */
  label: string;
  depth: number;
}

/** Every folder and section for a picker, in tree order, each named by its path. */
export const folderChoices = (folders: readonly Group[]): FolderChoice[] =>
  groupTree([...folders]).map(({ group, depth }) => ({ id: group.id, label: groupPath([...folders], group.id).join(' / '), depth }));

/** The places a folder or section may be moved into: not itself, nor anything inside it. */
export const validMoveTargets = (folders: readonly Group[], id: string): Group[] => validParents([...folders], id);

export const MAX_DESCRIPTION = 2000;

/** A description as it is kept: line breaks normalised, trimmed, and no longer than the limit. */
export const cleanDescription = (s: string): string => s.replace(/\r\n?/g, '\n').trim().slice(0, MAX_DESCRIPTION);

/** A name for a new folder or section among its siblings: the one given, or "Name 2", "Name 3"… when taken. */
export function uniqueName(folders: readonly Group[], parentId: string | null, wanted: string): string {
  const base = wanted.trim().slice(0, 60) || 'Untitled';
  const taken = new Set(childrenOf(folders, parentId).map((f) => f.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const name = `${base.slice(0, 55)} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
  return base;
}

/** The colour a new folder starts with: its parent's, or one that no folder has yet. */
export function startColor(folders: readonly Group[], parentId: string | null): GroupColor {
  const parent = parentId ? folders.find((f) => f.id === parentId) : undefined;
  if (parent) return parent.color;
  const used = folders.map((f) => f.color);
  return GROUP_COLORS.find((c) => !used.includes(c)) ?? GROUP_COLORS[folders.length % GROUP_COLORS.length];
}

/* ------------------------------------------------------------------ */
/* Cards filed under page groups, from before card folders existed     */
/* ------------------------------------------------------------------ */

/** Cards whose "set" is still one of the page groups (they show as unfiled until moved). */
export const cardsInPageGroups = (cards: readonly Page[], pageGroups: readonly Group[], folders: readonly Group[]): Page[] => {
  const g = idsOf(pageGroups);
  const f = idsOf(folders);
  return cards.filter((c) => !!c.groupId && g.has(c.groupId) && !f.has(c.groupId));
};

export interface LegacyPlan {
  /** The folders and sections to create: a copy of each page group the cards use, and the groups they sit in, with the same nesting. */
  create: Group[];
  /** Which folder each of those cards goes in. */
  assign: Map<string, string>;
}

/** Works out how to bring cards filed under page groups into card folders. Nothing about the page groups changes. */
export function planLegacyMove(cards: readonly Page[], pageGroups: readonly Group[], folders: readonly Group[], mkId: () => string): LegacyPlan {
  const parents = effectiveParents([...pageGroups]);
  const byId = new Map(pageGroups.map((g) => [g.id, g]));
  const newId = new Map<string, string>();
  const create: Group[] = [];
  const need = (id: string): string => {
    const have = newId.get(id);
    if (have) return have;
    const g = byId.get(id)!;
    const parentOld = parents.get(id) ?? null;
    const parent = parentOld && byId.has(parentOld) ? need(parentOld) : null;
    const made = mkId();
    newId.set(id, made);
    create.push({ id: made, name: uniqueName([...folders, ...create], parent, g.name), color: g.color, parentId: parent, scope: 'cards' });
    return made;
  };
  const assign = new Map<string, string>();
  for (const c of cardsInPageGroups(cards, pageGroups, folders)) assign.set(c.id, need(c.groupId!));
  return { create, assign };
}
