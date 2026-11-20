/**
 * Links you make on purpose: from a box (or a frame, or a card's details) to another page, card, box or frame. They are kept on the
 * box itself (`Block.links`), so they sync, back up and travel with a copied page, and an older app version just ignores them.
 * Pure: it works from the pages in memory and stores nothing.
 */
import type { Block, BoxLink, Page } from '../types';
import { isSafeId } from '../storage/validate';
import { cardLabel, cardParts } from './cards';
import { noteStyleLabel } from './note';
import { blockPlainText } from './pageText';
import { kindOf } from './pages';
import type { PageStub } from './workspaces';

export const MAX_LINKS = 40;

export const linksOf = (b: Pick<Block, 'links'>): BoxLink[] => (Array.isArray(b.links) ? b.links : []);
export const sameLink = (a: BoxLink, b: BoxLink) => a.page === b.page && (a.block ?? null) === (b.block ?? null);

/** Stored links brought into shape: only well-formed ones, no repeats, no more than MAX_LINKS. */
export function cleanLinks(v: unknown): BoxLink[] {
  if (!Array.isArray(v)) return [];
  const out: BoxLink[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.page !== 'string' || !isSafeId(o.page)) continue;
    const link: BoxLink = { page: o.page };
    if (typeof o.block === 'string' && isSafeId(o.block)) link.block = o.block;
    if (!out.some((l) => sameLink(l, link))) out.push(link);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

export const addLink = (links: BoxLink[], link: BoxLink): BoxLink[] =>
  links.some((l) => sameLink(l, link)) || links.length >= MAX_LINKS ? links : [...links, link.block ? { page: link.page, block: link.block } : { page: link.page }];
/** `old` replaced by `next` where it stood (nothing changes when `old` is not there; no repeat is made when `next` is already linked). */
export function replaceLink(links: BoxLink[], old: BoxLink, next: BoxLink): BoxLink[] {
  const at = links.findIndex((l) => sameLink(l, old));
  if (at < 0) return links;
  const clean: BoxLink = next.block ? { page: next.page, block: next.block } : { page: next.page };
  if (sameLink(old, clean)) return links;
  const out = links.map((l, i) => (i === at ? clean : l));
  return out.filter((l, i) => !sameLink(l, clean) || i === out.findIndex((x) => sameLink(x, clean)));
}
export const removeLink = (links: BoxLink[], link: BoxLink): BoxLink[] => links.filter((l) => !sameLink(l, link));

/** A short name for a box, to show in lists: a frame's title, or the first words it holds. */
export function boxLabel(b: Block): string {
  const text = blockPlainText(b).replace(/\s+/g, ' ').trim();
  if (b.type === 'image' && !text) return 'Picture';
  if (b.type === 'card') return 'Card';
  const kind = b.type === 'frame' ? 'Frame' : b.type === 'note' ? noteStyleLabel[b.style] : b.type[0].toUpperCase() + b.type.slice(1);
  return text ? `${kind}: ${text.length > 40 ? text.slice(0, 39) + '…' : text}` : `${kind} (empty)`;
}

export const pageLabel = (p: Page): string => (kindOf(p) === 'card' ? cardLabel(p) : p.title.trim() || 'Untitled');

export interface Resolved {
  page: Page | null;
  block: Block | null;
  /** What is missing: the whole page/card, or only the box on it. null = the link works. */
  broken: 'page' | 'block' | null;
  label: string;
  /** Set when the link leads to a page that is in another workspace (it is not loaded, so `page` is null but the link is not broken). */
  elsewhere?: PageStub;
}

/** Pages of the workspaces that are not open, and their names: what a link can lead to besides the pages on screen. */
export interface Others {
  stubs: readonly PageStub[];
  nameOf: (workspace: string) => string;
}

export function resolveLink(link: BoxLink, pages: Record<string, Page>, others?: Others): Resolved {
  const page = pages[link.page] ?? null;
  if (!page) {
    const stub = others?.stubs.find((s) => s.id === link.page);
    if (stub) return { page: null, block: null, broken: null, label: `${stub.title.trim() || 'Untitled'} · ${others!.nameOf(stub.workspace)}`, elsewhere: stub };
    return { page: null, block: null, broken: 'page', label: 'Missing page' };
  }
  if (!link.block) return { page, block: null, broken: null, label: pageLabel(page) };
  const block = page.blocks.find((b) => b.id === link.block) ?? null;
  if (!block) return { page, block: null, broken: 'block', label: `${pageLabel(page)} › missing box` };
  return { page, block, broken: null, label: `${pageLabel(page)} › ${boxLabel(block)}` };
}

/** The box that holds a card's links: its details box. */
export const cardLinkHolder = (card: Page): Block | null => cardParts(card).body;

export interface Edge {
  from: string;
  to: string;
  /** Which box the link starts at, and (when it points at one) which box it ends at. */
  fromBlock: string | null;
  toBlock: string | null;
}

/** Every deliberate link between pages and cards that leads somewhere that exists (a link to yourself is dropped). */
export function boxEdges(pages: Record<string, Page>): Edge[] {
  const out: Edge[] = [];
  for (const p of Object.values(pages)) {
    if (kindOf(p) === 'template') continue;
    for (const b of p.blocks) {
      for (const l of linksOf(b)) {
        const target = pages[l.page];
        if (!target || target.id === p.id || kindOf(target) === 'template') continue;
        out.push({ from: p.id, to: target.id, fromBlock: b.id, toBlock: l.block && target.blocks.some((x) => x.id === l.block) ? l.block : null });
      }
    }
  }
  return out;
}

/** Links that lead to this page or card (or only to one box on it when `blockId` is given), with where they start. */
export function incomingLinks(pageId: string, pages: Record<string, Page>, blockId?: string): { page: Page; block: Block }[] {
  const out: { page: Page; block: Block }[] = [];
  for (const p of Object.values(pages)) {
    if (p.id === pageId || kindOf(p) === 'template') continue;
    for (const b of p.blocks) {
      if (linksOf(b).some((l) => l.page === pageId && (blockId === undefined || l.block === blockId))) out.push({ page: p, block: b });
    }
  }
  return out.sort((a, b) => pageLabel(a.page).localeCompare(pageLabel(b.page)) || a.block.y - b.block.y);
}

/** What can be linked to: every page and card except the one you are on (its own boxes are offered separately), newest first. */
export function linkTargets(pages: Record<string, Page>, query = ''): Page[] {
  const q = query.trim().toLowerCase();
  return Object.values(pages)
    .filter((p) => kindOf(p) !== 'template' && (!q || pageLabel(p).toLowerCase().includes(q)))
    .sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id));
}

/** The boxes of a page that can be linked to, in reading order. */
export function linkableBoxes(page: Page): Block[] {
  return [...page.blocks].sort((a, b) => a.y - b.y || a.x - b.x);
}
