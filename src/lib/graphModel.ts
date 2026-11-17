/**
 * What the graph view draws (pure): pages, cards and (if asked) tags as nodes; links, box links and tag use as edges. Built on `linkGraph`
 * (lib/links.ts), so it agrees with "Linked from" everywhere. Nothing is stored: it is worked out from the pages in memory.
 */
import type { Group, Page } from '../types';
import { normTag } from './util';
import { linkGraph, neighbourhood, type GraphEdge } from './links';
import { pageApp, type OfficeApp } from './office/app';
import { withDescendants } from './groups';

export type GNodeKind = 'page' | 'card' | 'tag';

export interface GNode {
  id: string;
  title: string;
  kind: GNodeKind;
  /** Links in and out (tag nodes: pages that use the tag). */
  links: number;
  /** The group a page is in, or null (cards and tags have none). */
  groupId: string | null;
  /** A Workspace page's kind, so documents, spreadsheets and presentations can look different. */
  app: OfficeApp | null;
}

export interface GEdge {
  from: string;
  to: string;
  kind: GraphEdge['kind'] | 'tag';
  via?: GraphEdge['via'];
}

export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}

export interface GraphOptions {
  cards: boolean;
  /** Links made on boxes and frames. */
  boxes: boolean;
  /** [[Page title]] links. */
  text: boolean;
  /** Tags as nodes joined to the pages that use them. */
  tags: boolean;
  /** Keep nodes that nothing links to. */
  orphans: boolean;
  /** Only pages in this group (and inside it). */
  groupId?: string | null;
  /** Only pages and cards carrying this tag. */
  tag?: string | null;
  /** Only what is within `depth` links of `here` (0 = everything). */
  here?: string | null;
  depth?: number;
}

export const DEFAULT_GRAPH_OPTIONS: GraphOptions = { cards: true, boxes: true, text: true, tags: false, orphans: true };

export const tagNodeId = (tag: string) => `tag:${tag}`;
export const isTagNode = (id: string) => id.startsWith('tag:');

export function buildGraph(pages: Record<string, Page>, groups: Group[], o: GraphOptions): Graph {
  const base = linkGraph(pages, { cards: o.cards, boxes: o.boxes, text: o.text });
  let nodes: GNode[] = base.nodes.map((n) => ({ id: n.id, title: n.title, kind: n.kind, links: n.links, groupId: pages[n.id]?.groupId ?? null, app: pageApp(pages[n.id]) }));
  let edges: GEdge[] = base.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, via: e.via }));

  // Narrow to a group and/or a tag before anything is added or counted.
  const inGroups = o.groupId ? withDescendants(groups, o.groupId) : null;
  if (inGroups || o.tag) {
    const keep = new Set(
      nodes
        .filter((n) => {
          const p = pages[n.id];
          if (!p) return false;
          if (inGroups && (n.kind === 'card' || !p.groupId || !inGroups.has(p.groupId))) return false;
          return !o.tag || p.tags.includes(o.tag);
        })
        .map((n) => n.id),
    );
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  }

  if (o.tags) {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      for (const raw of pages[n.id]?.tags ?? []) {
        const t = normTag(raw);
        if (!t) continue;
        edges.push({ from: n.id, to: tagNodeId(t), kind: 'tag' });
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    for (const [t, c] of counts) nodes.push({ id: tagNodeId(t), title: `#${t}`, kind: 'tag', links: c, groupId: null, app: null });
  }

  // Recount links now that tags may have been added, then drop what nothing is joined to.
  const count = new Map<string, number>();
  for (const e of edges) {
    count.set(e.from, (count.get(e.from) ?? 0) + 1);
    count.set(e.to, (count.get(e.to) ?? 0) + 1);
  }
  nodes = nodes.map((n) => ({ ...n, links: count.get(n.id) ?? 0 }));
  if (!o.orphans) nodes = nodes.filter((n) => n.links > 0);
  const ids = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  if (o.depth && o.here) {
    const local = neighbourhood({ nodes: nodes.map((n) => ({ id: n.id, title: n.title, links: n.links, kind: n.kind === 'card' ? 'card' : 'page' })), edges: edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind === 'tag' ? 'text' : e.kind })) }, o.here, o.depth);
    const keep = new Set(local.nodes.map((n) => n.id));
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  }
  return { nodes, edges };
}

/** Node ids whose title contains the search text (ignoring case); null when nothing is typed. */
export function matchIds(g: Graph, query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return new Set(g.nodes.filter((n) => n.title.toLowerCase().includes(q)).map((n) => n.id));
}

/** The dot's radius: bigger with more links, within limits, scaled by the person's size setting. */
export const nodeRadius = (links: number, scale = 1): number => (4 + Math.min(Math.sqrt(links) * 2.2, 12)) * Math.min(2.5, Math.max(0.5, scale));
