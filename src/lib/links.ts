/**
 * What is derived from [[Page title]] links and the content of pages: outgoing links, an outline of a page, and the link graph.
 * Reading the links themselves (`extractLinks`, `blockPlainText`) is shared with the graph layer in graph/text.ts, so both agree
 * on what counts as a link. Nothing here is stored, so it needs no migration, never changes what syncs, and works the same in
 * the browser build. (The "Linked from" button uses the desktop graph database and is left as it is.)
 */
import type { Page } from '../types';
import { blockPlainText, extractLinks, htmlToText } from '../graph/text';
import { libraryPages } from './pages';

/** Titles of the pages that `page` links to, in order of first appearance. */
export function linkedTitles(page: Page): string[] {
  return extractLinks(page.blocks.map(blockPlainText).join('\n'));
}

/** The page a link title means: the oldest page with that title (ignoring case), or null. */
export function resolveTitle(title: string, pages: Record<string, Page>): Page | null {
  const key = title.trim().toLowerCase();
  let best: Page | null = null;
  for (const p of libraryPages(pages)) {
    if (p.title.trim().toLowerCase() !== key) continue;
    if (!best || p.created < best.created || (p.created === best.created && p.id < best.id)) best = p;
  }
  return best;
}

export interface Outgoing {
  title: string;
  /** The page it leads to; null when no page has that title yet. */
  page: Page | null;
}

export function outgoingLinks(page: Page, pages: Record<string, Page>): Outgoing[] {
  return linkedTitles(page).map((title) => ({ title, page: resolveTitle(title, pages) }));
}

export interface OutlineItem {
  blockId: string;
  /** 1–3 for headings; frames count as level 1. */
  level: number;
  text: string;
  kind: 'heading' | 'frame';
}

/** The headings of a page's text boxes and its frame titles, in reading order (top to bottom, then left to right). */
export function outline(page: Page): OutlineItem[] {
  const rows: { y: number; x: number; i: number; item: OutlineItem }[] = [];
  page.blocks.forEach((b, i) => {
    if (b.type === 'frame') {
      const text = b.title.trim();
      if (text) rows.push({ y: b.y, x: b.x, i, item: { blockId: b.id, level: 1, text, kind: 'frame' } });
    } else if (b.type === 'text') {
      for (const m of b.html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
        const text = htmlToText(m[2]).trim();
        if (text) rows.push({ y: b.y, x: b.x, i, item: { blockId: b.id, level: Number(m[1]), text, kind: 'heading' } });
      }
    }
  });
  return rows.sort((a, b) => a.y - b.y || a.x - b.x || a.i - b.i).map((r) => r.item);
}

export interface LinkGraph {
  nodes: { id: string; title: string; links: number }[];
  edges: { from: string; to: string }[];
}

/** Every page and the links between them. `links` counts links in and out. Self-links and repeats are dropped. */
export function linkGraph(pages: Record<string, Page>): LinkGraph {
  const list = libraryPages(pages);
  const count = new Map<string, number>(list.map((p) => [p.id, 0]));
  const seen = new Set<string>();
  const edges: LinkGraph['edges'] = [];
  for (const p of list) {
    for (const t of linkedTitles(p)) {
      const to = resolveTitle(t, pages);
      if (!to || to.id === p.id) continue;
      const key = p.id + '>' + to.id;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: p.id, to: to.id });
      count.set(p.id, (count.get(p.id) ?? 0) + 1);
      count.set(to.id, (count.get(to.id) ?? 0) + 1);
    }
  }
  return { nodes: list.map((p) => ({ id: p.id, title: p.title || 'Untitled', links: count.get(p.id) ?? 0 })), edges };
}

/** A simple force layout in a width × height box, run for a fixed number of steps so the result is the same every time. */
export function layoutGraph(g: LinkGraph, width: number, height: number, steps = 220): Map<string, { x: number; y: number }> {
  const n = g.nodes.length;
  const pos = new Map<string, { x: number; y: number }>();
  const cx = width / 2;
  const cy = height / 2;
  g.nodes.forEach((node, i) => {
    const a = (i / Math.max(n, 1)) * Math.PI * 2;
    const r = Math.min(width, height) * 0.35;
    pos.set(node.id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  });
  if (n < 2) return pos;
  const k = Math.sqrt((width * height) / n) * 0.6;
  for (let s = 0; s < steps; s++) {
    const t = 1 - s / steps;
    const disp = new Map(g.nodes.map((nd) => [nd.id, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(g.nodes[i].id)!;
        const b = pos.get(g.nodes[j].id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) { dx = 0.01 * (i + 1); dy = 0.01 * (j + 1); d = Math.hypot(dx, dy); }
        const f = (k * k) / d;
        disp.get(g.nodes[i].id)!.x += (dx / d) * f;
        disp.get(g.nodes[i].id)!.y += (dy / d) * f;
        disp.get(g.nodes[j].id)!.x -= (dx / d) * f;
        disp.get(g.nodes[j].id)!.y -= (dy / d) * f;
      }
    }
    for (const e of g.edges) {
      const a = pos.get(e.from)!;
      const b = pos.get(e.to)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d * d) / k;
      disp.get(e.from)!.x -= (dx / d) * f;
      disp.get(e.from)!.y -= (dy / d) * f;
      disp.get(e.to)!.x += (dx / d) * f;
      disp.get(e.to)!.y += (dy / d) * f;
    }
    for (const nd of g.nodes) {
      const p = pos.get(nd.id)!;
      const dd = disp.get(nd.id)!;
      dd.x += (cx - p.x) * 0.05 * k * 0.1;
      dd.y += (cy - p.y) * 0.05 * k * 0.1;
      const len = Math.hypot(dd.x, dd.y) || 1;
      const step = Math.min(len, 12 * t + 1);
      p.x = Math.min(width - 24, Math.max(24, p.x + (dd.x / len) * step));
      p.y = Math.min(height - 24, Math.max(24, p.y + (dd.y / len) * step));
    }
  }
  return pos;
}
