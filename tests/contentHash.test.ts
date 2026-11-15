import { describe, expect, it, vi } from 'vitest';
import { assembleBlocks, blockHash, FINGERPRINT_LENGTH, packRefs, sha256Hex, shareBlocks, stableJson, unpackRefs } from '../src/lib/contentHash';
import type { Block } from '../src/types';

const text = (id: string, html: string, extra: Partial<Block> = {}): Block => ({ id, type: 'note', style: 'text', x: 0, y: 0, w: 100, h: 40, z: 1, html, ...extra }) as Block;

describe('fingerprints', () => {
  it('give the known SHA-256 for known input, from text or bytes', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('are 64 hex characters and differ when one byte differs', async () => {
    const a = await sha256Hex(new Uint8Array([1, 2, 3]));
    const b = await sha256Hex(new Uint8Array([1, 2, 4]));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('stable JSON', () => {
  it('does not depend on the order keys were added in, at any depth', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }));
  });
  it('keeps array order, drops undefined keys, and writes plain values like JSON does', () => {
    expect(stableJson([3, 1, 2])).toBe('[3,1,2]');
    expect(stableJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(stableJson('x')).toBe('"x"');
    expect(stableJson(null)).toBe('null');
    expect(stableJson([undefined])).toBe('[null]');
  });
  it('gives two boxes with the same content the same fingerprint whatever their key order', async () => {
    const a = text('b1', '<p>hi</p>');
    const b = JSON.parse(JSON.stringify({ html: '<p>hi</p>', z: 1, id: 'b1', type: 'note', style: 'text', h: 40, w: 100, y: 0, x: 0 })) as Block;
    expect(await blockHash(a)).toBe(await blockHash(b));
    expect(await blockHash(a)).toMatch(new RegExp(`^[0-9a-f]{${FINGERPRINT_LENGTH}}$`));
    expect(await blockHash(a)).not.toBe(await blockHash(text('b1', '<p>hi!</p>')));
    expect(await blockHash(a)).not.toBe(await blockHash(text('b1', '<p>hi</p>', { x: 5 })));
  });
});

describe('sharing boxes between versions', () => {
  it('stores each distinct box once, however many times it appears', async () => {
    const same = text('a', '<p>same</p>');
    const { refs, store } = await shareBlocks([same, text('b', '<p>other</p>'), { ...same }, same]);
    expect(refs).toHaveLength(4);
    expect(store.size).toBe(2);
    expect(refs[0]).toBe(refs[2]);
    expect(refs[0]).toBe(refs[3]);
  });
  it('rebuilds the boxes in order from the store', async () => {
    const blocks = [text('a', '<p>1</p>'), text('b', '<p>2</p>'), text('c', '<p>3</p>')];
    const { refs, store } = await shareBlocks(blocks);
    expect(assembleBlocks(refs, store)).toEqual(blocks);
  });
  it('skips a box the store no longer has, and a damaged one, rather than failing', async () => {
    const { refs, store } = await shareBlocks([text('a', '<p>1</p>'), text('b', '<p>2</p>')]);
    store.delete(refs[0]);
    expect(assembleBlocks(refs, store).map((b) => b.id)).toEqual(['b']);
    store.set(refs[1], '{not json');
    expect(assembleBlocks(refs, store)).toEqual([]);
  });
  it('makes a version that is just a list of fingerprints, and tells it from the older full form', async () => {
    const packed = packRefs(['a'.repeat(64), 'b'.repeat(64)]);
    expect(unpackRefs(packed)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    expect(unpackRefs('[{"id":"x","type":"text"}]')).toBeNull(); // the older form: boxes written out
    expect(unpackRefs('{"refs":[1,2]}')).toBeNull();
    expect(unpackRefs('{broken')).toBeNull();
    expect(unpackRefs('')).toBeNull();
  });
  it('shares nothing for an empty page', async () => {
    expect(await shareBlocks([])).toEqual({ refs: [], store: new Map() });
  });
});

describe('the plain-code SHA-256 (used when crypto.subtle is missing)', () => {
  it('gives the same answer as the real one, for lengths around the block edges', async () => {
    const { sha256Bytes } = await import('../src/lib/contentHash');
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
      const real = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      expect([...sha256Bytes(bytes)]).toEqual([...real]);
    }
  });
  it('is used when the browser has no crypto.subtle', async () => {
    const { sha256Hex } = await import('../src/lib/contentHash');
    const want = await sha256Hex('abc');
    expect(want).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    vi.stubGlobal('crypto', {});
    try {
      expect(await sha256Hex('abc')).toBe(want);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
