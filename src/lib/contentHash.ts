/**
 * Content fingerprints (pure). The same bytes, or the same box, always give the same fingerprint, so the database can store a piece of
 * data once and point at it from every page, version and picture reference that uses it.
 */
import type { Block } from '../types';

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 in plain code (FIPS 180-4), for a page where `crypto.subtle` is not available. Exported so a test can check it against the real one. */
export function sha256Bytes(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((data.length * 8) / 0x100000000));
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

/** SHA-256 of some bytes or text, as 64 hex characters. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  // The browser's own implementation when there is one (it is only missing in an insecure page); otherwise the same maths in plain code.
  const subtle = globalThis.crypto?.subtle;
  const digest = subtle ? new Uint8Array(await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)) : sha256Bytes(bytes);
  let out = '';
  for (const b of digest) out += HEX[b];
  return out;
}

/** JSON with the keys of every object in sorted order, so two boxes with the same content always read the same, however they were built. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v === undefined ? null : v)).join(',')}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
}

/**
 * A box's fingerprint: the first 128 bits of its SHA-256 (32 hex characters). Half the length keeps each version's list of boxes small, and
 * two different boxes sharing one is as unlikely as a coin landing heads 64 times in a row.
 */
export const FINGERPRINT_LENGTH = 32;
export const blockHash = async (b: Block): Promise<string> => (await sha256Hex(stableJson(b))).slice(0, FINGERPRINT_LENGTH);

/** The shape of a version's boxes in storage: the fingerprints, in order. The boxes themselves are stored once each, elsewhere. */
export interface BlockRefs {
  refs: string[];
}

export const packRefs = (refs: string[]): string => JSON.stringify({ refs } satisfies BlockRefs);

/** The fingerprints in a stored version, or null when it is the older form (the boxes written out in full). */
export function unpackRefs(text: string): string[] | null {
  if (!text.startsWith('{')) return null;
  try {
    const v = JSON.parse(text) as Partial<BlockRefs>;
    return Array.isArray(v.refs) && v.refs.every((r) => typeof r === 'string') ? v.refs : null;
  } catch {
    return null;
  }
}

/**
 * Splits boxes into what to store (each distinct box once, by fingerprint) and what a version keeps (the fingerprints in order).
 * Two equal boxes in one version, or in any number of versions or pages, add one row between them.
 */
export async function shareBlocks(blocks: readonly Block[]): Promise<{ refs: string[]; store: Map<string, string> }> {
  const store = new Map<string, string>();
  const refs: string[] = [];
  for (const b of blocks) {
    const json = stableJson(b);
    const h = (await sha256Hex(json)).slice(0, FINGERPRINT_LENGTH);
    refs.push(h);
    if (!store.has(h)) store.set(h, json);
  }
  return { refs, store };
}

/** The boxes of a version, in order, from its fingerprints and what the store holds. A fingerprint the store lacks is skipped (that box is lost). */
export function assembleBlocks(refs: readonly string[], lookup: ReadonlyMap<string, string>): Block[] {
  const out: Block[] = [];
  for (const r of refs) {
    const json = lookup.get(r);
    if (json === undefined) continue;
    try {
      out.push(JSON.parse(json) as Block);
    } catch {
      /* a damaged row is skipped, not fatal */
    }
  }
  return out;
}
