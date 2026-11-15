/** Cards: a label, a cover picture and details. A card is a page of its own kind, so it is stored, synced and backed up like one. */
import type { Block, ImageBlock, NoteBlock, Page } from '../types';
import { blockText, newId, normTag } from './util';

export const COVER_W = 320;
const GAP = 24;

export interface CardParts {
  /** The cover picture: the card's first picture box. */
  cover: ImageBlock | null;
  /** The details: the card's first text box. */
  body: NoteBlock | null;
}

const byOrder = (a: Block, b: Block) => (a.z || 0) - (b.z || 0) || a.y - b.y || a.x - b.x;

export function cardParts(p: Pick<Page, 'blocks'>): CardParts {
  const sorted = [...p.blocks].sort(byOrder);
  return {
    cover: (sorted.find((b) => b.type === 'image') as ImageBlock | undefined) ?? null,
    body: (sorted.find((b) => b.type === 'note' && b.style === 'text') as NoteBlock | undefined) ?? null,
  };
}

export const cardLabel = (p: Pick<Page, 'title'>) => p.title.trim() || 'Untitled card';

/** The details as plain text. */
export const cardText = (p: Pick<Page, 'blocks'>): string => {
  const { body } = cardParts(p);
  return body ? blockText(body).trim() : '';
};

/** The first letter shown on a card with no cover. */
export const cardInitial = (p: Pick<Page, 'title'>) => (cardLabel(p).match(/[\p{L}\p{N}]/u)?.[0] ?? '•').toUpperCase();

export const newBody = (y = 0): NoteBlock => ({ id: newId(), type: 'note', style: 'text', x: 0, y, w: COVER_W, h: 120, z: 1, html: '' });

/** A new card starts with an empty details box. */
export const newCardBlocks = (): Block[] => [newBody()];

/**
 * The blocks with the cover set to a picture (or removed with null). The details box moves down to
 * make room, so opening the card as a page on the canvas still reads top to bottom.
 */
export function withCover(blocks: Block[], cover: { imageId: string; aspect: number } | null): Block[] {
  const next = blocks.map((b) => ({ ...b })) as Block[];
  const existing = cardParts({ blocks: next }).cover;
  if (!cover) return existing ? next.filter((b) => b.id !== existing.id) : next;
  const aspect = cover.aspect > 0 && Number.isFinite(cover.aspect) ? cover.aspect : 4 / 3;
  const h = Math.round(COVER_W / aspect);
  if (existing) {
    Object.assign(existing, { imageId: cover.imageId, aspect, h });
    return next;
  }
  const z = next.reduce((m, b) => Math.max(m, b.z || 0), 0) + 1;
  next.push({ id: newId(), type: 'image', x: 0, y: 0, w: COVER_W, h, z, imageId: cover.imageId, aspect } as ImageBlock);
  const { body } = cardParts({ blocks: next });
  if (body && body.y < h + GAP) body.y = h + GAP;
  return next;
}

/**
 * Cards whose label, details or tags contain every word of the query, in the order given.
 * A word written `#garden` or `tag:garden` is different: it must be exactly one of the card's tags.
 */
export function searchCards(cards: Page[], query: string): Page[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return cards;
  const wantTags: string[] = [];
  const wantText: string[] = [];
  for (const w of words) {
    const m = w.match(/^(?:#|tag:)(.*)$/);
    if (!m) wantText.push(w);
    else if (normTag(m[1])) wantTags.push(normTag(m[1]));
  }
  return cards.filter((c) => {
    if (!wantTags.every((t) => c.tags.includes(t))) return false;
    const hay = `${cardLabel(c)} ${cardText(c)} ${c.tags.join(' ')}`.toLowerCase();
    return wantText.every((w) => hay.includes(w));
  });
}

/** The tags used by these cards with how many cards have each, most used first. */
export function cardTagCounts(cards: Page[]): { tag: string; count: number }[] {
  const n = new Map<string, number>();
  for (const c of cards) for (const t of new Set(c.tags)) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
