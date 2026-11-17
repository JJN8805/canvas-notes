/** What to embed and what to forget (pure): the passages now, against the ones already stored. */
import { passageKey, type Passage } from '../notesSearch';

/** A fast fingerprint of text, to notice that a passage changed (not for security). 53 bits, as a string. */
export function textHash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** What a passage is embedded as: its page title and its text, so "Budget" at the top of a page helps its passages be found. */
export const embedText = (p: Pick<Passage, 'title' | 'text'>): string => `${p.title}\n${p.text}`.slice(0, 1200);
export const passageHash = (p: Pick<Passage, 'title' | 'text'>): string => textHash(embedText(p));

export interface StoredKey {
  pageId: string;
  blockId: string;
  chunk: number;
  hash: string;
}

export interface IndexPlan {
  /** Passages with no vector yet, or whose text has changed. */
  embed: Passage[];
  /** Stored vectors of passages that no longer exist (the text was deleted, the page was trashed). */
  forget: StoredKey[];
  /** Passages that already have an up-to-date vector. */
  fresh: number;
}

/** At most this many passages are kept in the index; a larger library keeps its most recently edited pages. */
export const MAX_INDEXED = 60_000;

export function indexPlan(passages: readonly Passage[], stored: readonly StoredKey[], max = MAX_INDEXED): IndexPlan {
  const wanted = passages.length > max ? [...passages].sort((a, b) => b.updated - a.updated).slice(0, max) : passages;
  const have = new Map(stored.map((s) => [passageKey(s), s]));
  const embed: Passage[] = [];
  let fresh = 0;
  const live = new Set<string>();
  for (const p of wanted) {
    const key = passageKey(p);
    live.add(key);
    const s = have.get(key);
    if (s && s.hash === passageHash(p)) fresh++;
    else embed.push(p);
  }
  const forget = stored.filter((s) => !live.has(passageKey(s)));
  return { embed, forget, fresh };
}
