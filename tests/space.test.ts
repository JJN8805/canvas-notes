import { describe, expect, it } from 'vitest';
import { applyDepth, boxCentre, boxCorners, clampDepth, DEPTH_MAX, DEPTH_MIN, fanOut, flattenDepth, pageCentre, pointInQuad, rayPlaneZ, snippet, toPage, toWorld } from '../src/lib/space';
import { cleanBlock } from '../src/lib/sanitize';
import { DEFAULT_CAMERA, project, unproject } from '../src/lib/tree3d';
import type { Block } from '../src/types';

const note = (id: string, o: Partial<Block> = {}): Block => ({ id, type: 'note', style: 'text', x: 0, y: 0, w: 100, h: 40, z: 1, html: '', ...o }) as Block;

describe('depth', () => {
  it('is a whole number inside the limits, and 0 for anything else', () => {
    expect(clampDepth(12.6)).toBe(13);
    expect(clampDepth(1e9)).toBe(DEPTH_MAX);
    expect(clampDepth(-1e9)).toBe(DEPTH_MIN);
    for (const bad of [NaN, Infinity, '5', null, undefined, {}]) expect(clampDepth(bad)).toBe(0);
  });
  it('is kept on a box when stored, and repaired when it is odd (absent means 0)', () => {
    expect(cleanBlock(note('a', { depth: 80 }))).toMatchObject({ depth: 80 });
    expect(cleanBlock(note('a', { depth: 1e9 }))).toMatchObject({ depth: DEPTH_MAX });
    for (const bad of [0, 0.2, NaN, 'deep', null, Infinity]) expect(cleanBlock(note('a', { depth: bad as never }))).not.toHaveProperty('depth');
  });
  it('survives a round trip through JSON like any other box field', () => {
    const b = cleanBlock(note('a', { depth: -240 }))!;
    expect(cleanBlock(JSON.parse(JSON.stringify(b)))).toEqual(b);
  });
});

describe('placing boxes in space', () => {
  const o = { x: 100, y: 50 };
  it('puts nearer boxes at smaller z, and the page y axis upward', () => {
    expect(toWorld(100, 50, 0, o)).toEqual({ x: 0, y: -0, z: -0 });
    expect(toWorld(110, 30, 200, o)).toEqual({ x: 10, y: 20, z: -200 });
    expect(toPage(10, 20, o)).toEqual({ x: 110, y: 30 });
  });
  it('knows the corners and the centre of a box', () => {
    const b = note('a', { x: 100, y: 50, w: 100, h: 40, depth: 40 });
    const [tl, tr, br, bl] = boxCorners(b, o);
    expect([tl.x, tl.y, tr.x, br.y, bl.x]).toEqual([0, -0, 100, -40, 0]);
    expect(tl.z).toBe(-40);
    expect(boxCentre(b, o)).toEqual({ x: 50, y: -20, z: -40 });
  });
  it('centres on the boxes, and on nothing when there are none', () => {
    expect(pageCentre([])).toEqual({ x: 0, y: 0 });
    expect(pageCentre([note('a', { x: 0, y: 0, w: 100 }), note('b', { x: 200, y: 100, w: 100 })])).toEqual({ x: 150, y: 70 });
  });
  it('finds a point inside a skewed box, and not outside', () => {
    const q = [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 90, y: 60 }, { x: -5, y: 50 }];
    expect(pointInQuad(50, 30, q)).toBe(true);
    expect(pointInQuad(150, 30, q)).toBe(false);
    expect(pointInQuad(50, 90, q)).toBe(false);
  });
  it('turns a pointer position into a place on a layer: project, then cast a ray, gets the same spot', () => {
    const cam = { yaw: 0.7, pitch: 0.3, dist: 900, target: { x: 0, y: 0, z: 0 } };
    for (const depth of [-300, 0, 150]) {
      const world = toWorld(40, -25, depth, { x: 0, y: 0 });
      const at = project(world, cam, 800, 600)!;
      const hit = rayPlaneZ(unproject(at.x, at.y, cam.dist * 0.5, cam, 800, 600), unproject(at.x, at.y, cam.dist * 1.5, cam, 800, 600), -depth)!;
      expect(hit.x).toBeCloseTo(world.x, 6);
      expect(hit.y).toBeCloseTo(world.y, 6);
    }
    expect(rayPlaneZ({ x: 0, y: 0, z: 5 }, { x: 9, y: 9, z: 5 }, 0)).toBeNull();
    expect(project({ x: 0, y: 0, z: 0 }, DEFAULT_CAMERA, 100, 100)).not.toBeNull();
  });
});

describe('changing depth', () => {
  const boxes = () => [note('a', { z: 1 }), note('b', { z: 2 }), note('c', { z: 3, locked: true }), { ...note('f', { z: 0 }), type: 'frame' } as unknown as Block];
  it('sets the depth of chosen boxes, never of frames or locked boxes', () => {
    const bs = boxes();
    expect(applyDepth(bs, ['a', 'c', 'f'], 120)).toBe(1);
    expect(bs.map((b) => b.depth)).toEqual([120, undefined, undefined, undefined]);
    expect(applyDepth(bs, ['a'], 120)).toBe(0); // already there
    expect(applyDepth(bs, ['a'], 0)).toBe(1);
    expect(bs[0]).not.toHaveProperty('depth');
    expect(applyDepth(bs, ['a'], 1e9)).toBe(1);
    expect(bs[0].depth).toBe(DEPTH_MAX);
  });
  it('fans boxes out by stacking order around the page, the top one nearest', () => {
    const bs = boxes();
    expect(fanOut(bs, 40)).toBe(2); // a goes back and b comes forward; c (locked) and the frame stay
    expect(bs[0].depth).toBe(-20);
    expect(bs[1].depth).toBe(20);
    expect(bs[2].depth).toBeUndefined();
    const three = [note('x', { z: 1 }), note('y', { z: 2 }), note('w', { z: 3 })];
    fanOut(three, 50);
    expect(three.map((b) => b.depth)).toEqual([-50, undefined, 50]);
  });
  it('puts everything back on the page', () => {
    const bs = [note('a', { depth: 80 }), note('b', { depth: -80 }), note('c', { depth: 80, locked: true })];
    expect(flattenDepth(bs)).toBe(2);
    expect(bs.map((b) => b.depth)).toEqual([undefined, undefined, 80]);
  });
});

describe('what a box says in the picture', () => {
  it('is plain words, with tags and entities removed', () => {
    expect(snippet(note('a', { html: '<h1>Plan &amp; goals</h1><p>First&nbsp;step</p>' }))).toBe('Plan & goals\nFirst step');
    expect(snippet(note('a', { html: '<p>x</p>'.repeat(200) }), 20).length).toBeLessThanOrEqual(20);
  });
  it('covers lists, code and tables, and never returns markup', () => {
    expect(snippet({ id: 'l', type: 'checklist', x: 0, y: 0, w: 1, h: 1, z: 1, items: [{ id: '1', text: 'milk', done: true }, { id: '2', text: 'eggs', done: false }] } as Block)).toBe('☑ milk\n☐ eggs');
    expect(snippet(note('c', { style: 'code', code: 'let a = 1;' } as Partial<Block>))).toBe('let a = 1;');
    expect(snippet({ id: 't', type: 'table', x: 0, y: 0, w: 1, h: 1, z: 1, rows: [['a', 'b']] } as Block)).toBe('a · b');
    expect(snippet(note('s', { html: '<img src=x onerror=alert(1)><script>1</script>hi' }))).not.toMatch(/</);
  });
});
