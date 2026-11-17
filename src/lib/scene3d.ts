/**
 * What the combined graph view draws (pure): ONE set of nodes that can be laid out two ways, as a live network (force layout) or as a
 * hierarchy (the cone tree). The nodes are the library, its groups, pages, cards, tags and (if asked) the headings inside pages; the lines
 * are the hierarchy (a node under its parent) and the links you made (box links, [[text]] links, tag use). Everything the graph filters do
 * (tags, orphans, cards, group, tag, around-this-page) decides which pages stay; groups with nothing left in them are dropped while a
 * filter is on. Built on `buildGraph` and `buildTree`, so it agrees with "Linked from" and the outline. Nothing is stored.
 */
import type { Group, Page } from '../types';
import { buildGraph, isTagNode, type GEdge, type GraphOptions } from './graphModel';
import { buildTree, finishTree, flatten, type TNode } from './tree3d';

export interface SceneOptions extends GraphOptions {
  /** Headings under their pages. */
  headings: boolean;
}

export interface SceneEdge {
  from: string;
  to: string;
  kind: GEdge['kind'];
  via?: GEdge['via'];
}

export interface Scene {
  /** The whole tree after filtering (the list beside the picture shows this). */
  tree: TNode;
  /** Links between nodes, by scene id (the hierarchy lines come from the tree itself). */
  edges: SceneEdge[];
}

/** A page's id in the scene (its raw id is the one links use). */
export const pageNodeId = (id: string) => `p:${id}`;
export const cardNodeId = (id: string) => `c:${id}`;
/** Where a graph node (a page, card or `tag:name`) lives in the scene. */
export const sceneId = (graphId: string, kind: 'page' | 'card' | 'tag') => (kind === 'page' ? pageNodeId(graphId) : kind === 'card' ? cardNodeId(graphId) : graphId);

export function buildScene(pages: Record<string, Page>, groups: Group[], o: SceneOptions): Scene {
  const graph = buildGraph(pages, groups, o);
  const tree = buildTree(pages, groups, { headings: o.headings });
  const kind = new Map(graph.nodes.map((n) => [n.id, n]));
  const filtered = !!(o.groupId || o.tag || !o.orphans || (o.here && o.depth));

  // Keep the pages the graph kept, the headings under them, and (while filtering) only the groups that still hold something.
  const prune = (n: TNode): boolean => {
    if (n.kind === 'page') {
      const g = n.pageId ? kind.get(n.pageId) : undefined;
      if (!g || g.kind !== 'page') return false;
      n.links = g.links;
      n.children = n.children.filter(prune);
      return true;
    }
    if (n.kind === 'heading') return true;
    n.children = n.children.filter(prune);
    return n.kind === 'root' || !filtered || n.children.length > 0;
  };
  prune(tree);

  // Cards and tags have no place in the groups, so each gets a section of its own under the library.
  const section = (id: string, label: string, color: string, kids: TNode[]) => {
    if (kids.length) tree.children.push({ id, label, kind: 'group', depth: 0, children: kids, color, weight: 1 });
  };
  const cards: TNode[] = [];
  const tags: TNode[] = [];
  for (const n of graph.nodes) {
    if (n.kind === 'card') cards.push({ id: cardNodeId(n.id), label: n.title || 'Untitled card', kind: 'card', depth: 0, children: [], pageId: n.id, links: n.links, weight: 1 });
    else if (n.kind === 'tag') tags.push({ id: n.id, label: n.title, kind: 'tag', depth: 0, children: [], links: n.links, weight: 1 });
  }
  section('sec:cards', 'Cards', 'ochre', cards);
  section('sec:tags', 'Tags', 'plum', tags);
  finishTree(tree);

  const present = new Set(flatten(tree).map((n) => n.id));
  const edges: SceneEdge[] = [];
  for (const e of graph.edges) {
    const a = kind.get(e.from);
    const b = kind.get(e.to);
    // Tag nodes have ids like `tag:x`; a page's raw id could in theory start the same way, so the kind decides.
    const from = a ? sceneId(a.id, a.kind) : isTagNode(e.from) ? e.from : null;
    const to = b ? sceneId(b.id, b.kind) : isTagNode(e.to) ? e.to : null;
    if (from && to && present.has(from) && present.has(to)) edges.push({ from, to, kind: e.kind, via: e.via });
  }
  return { tree, edges };
}

/** The ids of nodes whose name contains the search text (ignoring case); null when nothing is typed. */
export function matchNodes(nodes: readonly TNode[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return new Set(nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
}

/** The dot's size in the picture: a link-heavy page is bigger; groups and the library are always a little bigger than a page. */
export function sceneRadius(n: Pick<TNode, 'kind' | 'links'>, scale = 1): number {
  const s = Math.min(2.5, Math.max(0.5, scale));
  if (n.kind === 'root') return 12 * s;
  if (n.kind === 'group') return 9 * s;
  if (n.kind === 'heading') return 3.5 * s;
  return (4 + Math.min(Math.sqrt(n.links ?? 0) * 2.2, 10)) * s;
}
