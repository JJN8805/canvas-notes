/**
 * Vectors for searching by meaning (pure). A passage's embedding is kept as one signed byte per number plus a scale (about a quarter of the
 * space of 32-bit numbers, with no visible loss for ranking), and compared with a dot product on normalised vectors, which is cosine similarity.
 */

/** Longest vector accepted from a model or from storage. */
export const MAX_DIM = 4096;

export function normalize(v: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const x = Number(v[i]);
    out[i] = Number.isFinite(x) ? x : 0;
    sum += out[i] * out[i];
  }
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** True for a plain, finite, non-empty list of numbers of a sane length (what a model's answer must be before it is trusted). */
export function isVector(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.length <= MAX_DIM && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

export interface Quantized {
  dim: number;
  scale: number;
  /** base64 of one signed byte per number. */
  vec: string;
}

export function quantize(v: ArrayLike<number>): Quantized {
  const n = normalize(v);
  let max = 0;
  for (const x of n) max = Math.max(max, Math.abs(x));
  const scale = max || 1;
  const bytes = new Int8Array(n.length);
  for (let i = 0; i < n.length; i++) bytes[i] = Math.round((n[i] / scale) * 127);
  let bin = '';
  const u = new Uint8Array(bytes.buffer);
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return { dim: n.length, scale, vec: btoa(bin) };
}

/** The stored form back as a normalised vector, or null when it is damaged (wrong length, not base64, nonsense scale). */
export function dequantize(q: Quantized): Float32Array | null {
  if (!Number.isInteger(q.dim) || q.dim < 1 || q.dim > MAX_DIM || !Number.isFinite(q.scale) || q.scale <= 0 || typeof q.vec !== 'string') return null;
  let bin: string;
  try {
    bin = atob(q.vec);
  } catch {
    return null;
  }
  if (bin.length !== q.dim) return null;
  const out = new Float32Array(q.dim);
  for (let i = 0; i < q.dim; i++) out[i] = (((bin.charCodeAt(i) << 24) >> 24) / 127) * q.scale;
  return normalize(out);
}

/** Cosine similarity of two normalised vectors of the same length (0 when they differ in length). */
export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** The `k` stored vectors most like `query`, best first, ignoring any below `min`. */
export function topK(query: Float32Array, items: readonly { key: string; vec: Float32Array }[], k: number, min = 0.2): { key: string; score: number }[] {
  const scored: { key: string; score: number }[] = [];
  for (const it of items) {
    const score = dot(query, it.vec);
    if (score >= min) scored.push({ key: it.key, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  return scored.slice(0, k);
}
