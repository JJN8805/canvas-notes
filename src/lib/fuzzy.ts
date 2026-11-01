/** Fuzzy matching for the command palette and quick switcher. */

/**
 * How well `query` matches `text`: -1 if its letters don't all appear in order, otherwise a score where
 * bigger is better. Prefix and word-start matches and runs of consecutive letters score higher, and shorter text wins ties.
 * An empty query matches everything with score 0.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found < 0) return -1;
    const atStart = found === 0 || /[\s\-_/:.]/.test(t[found - 1]);
    run = found === ti && qi > 0 ? run + 1 : 0;
    score += 1 + run * 2 + (atStart ? 3 : 0) + (found === 0 ? 3 : 0);
    ti = found + 1;
  }
  if (t.includes(q)) score += 8;
  return score - t.length * 0.01;
}

/** Items that match, best first. `text` picks the string to match on. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, text(item)) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.item);
}
