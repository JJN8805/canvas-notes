/** Combining two rankings of the same passages (pure): reciprocal rank fusion, which needs no tuning because it uses only positions. */

export interface Ranked {
  /** Index into the passage list. */
  i: number;
}

/**
 * Passages ranked by how high each ranking puts them: score = sum of weight / (k + position). A passage that both rankings like
 * beats one that only one likes; one ranking being empty leaves the other's order unchanged.
 */
export function fuse(rankings: { order: readonly number[]; weight?: number }[], k = 60): number[] {
  const score = new Map<number, number>();
  const first = new Map<number, number>();
  rankings.forEach((r, ri) => {
    r.order.forEach((i, pos) => {
      score.set(i, (score.get(i) ?? 0) + (r.weight ?? 1) / (k + pos + 1));
      if (!first.has(i)) first.set(i, ri * 1e6 + pos);
    });
  });
  return [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)! || first.get(a)! - first.get(b)! || a - b);
}
