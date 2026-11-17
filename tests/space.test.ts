import { describe, expect, it } from 'vitest';
import { applyDepth, boxCentre, boxCorners, boxSolid, chosenDepth, clampDepth, DEPTH_MAX, DEPTH_MIN, DEPTH_STEP, effectiveDepths, FRAME_THICKNESS, LAYER_GAP, MAX_THICKNESS, MIN_THICKNESS, FACES, flattenDepth, followStacking, pageCentre, pointInQuad, rayPlaneZ, snippet, thicknessOf, toPage, toWorld, visibleFaces } from '../src/lib/space';
import { cleanBlock } from '../src/lib/sanitize';
import { cameraPosition, DEFAULT_CAMERA, project, unproject } from '../src/lib/tree3d';
import type { Block } from '../src/types';

const note = (id: string, o: Partial<Block> = {}): Block => ({ id, type: 'note', style: 'text', x: 0, y: 0, w: 100, h: 40, z: 1, html: '', ...o }) as Block;

describe('depth', () => {
  it('is a whole number inside the limits, and 0 for anything else', () => {
    expect(clampDepth(12.6)).toBe(13);
    expect(clampDepth(1e9)).toBe(DEPTH_MAX);
    expect(clampDepth(-1e9)).toBe(DEPTH_MIN);
    for (const bad of [NaN, Infinity, '5', null, undefined, {}]) expect(clampDepth(bad)).toBe(0);
  });
  it('is kept on a box when stored, even 0 (a chosen flat box), and repaired when it is odd (absent = follows the page)', () => {
    expect(cleanBlock(note('a', { depth: 80 }))).toMatchObject({ depth: 80 });
    expect(cleanBlock(note('a', { depth: 0 }))).toMatchObject({ depth: 0 });
    expect(cleanBlock(note('a', { depth: 0.2 }))).toMatchObject({ depth: 0 });
    expect(cleanBlock(note('a', { depth: 1e9 }))).toMatchObject({ depth: DEPTH_MAX });
    for (const bad of [NaN, 'deep', null, Infinity]) expect(cleanBlock(note('a', { depth: bad as never }))).not.toHaveProperty('depth');
  });
  it('tells a chosen depth from one that follows the page', () => {
    expect(chosenDepth({})).toBeNull();
    expect(chosenDepth({ depth: 0 })).toBe(0);
    expect(chosenDepth({ depth: 99999 })).toBe(DEPTH_MAX);
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
    const [tl, tr, br, bl] = boxCorners(b, o, 40);
    expect([tl.x, tl.y, tr.x, br.y, bl.x]).toEqual([0, -0, 100, -40, 0]);
    expect(tl.z).toBe(-40);
    expect(boxCentre(b, o, 40)).toEqual({ x: 50, y: -20, z: -40 });
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

describe('depth that follows the page', () => {
  const at = (id: string, x: number, y: number, z: number, o: Partial<Block> = {}) => note(id, { x, y, w: 100, h: 50, z, ...o });
  const L = thicknessOf(note('x', { w: 100, h: 50 })) + LAYER_GAP; // one layer of these 100 x 50 boxes
  const frame = (id: string, x: number, y: number, w: number, h: number, z = 0) => ({ id, type: 'frame', x, y, w, h, z, title: 'F', color: 'slate', collapsed: false }) as unknown as Block;

  it('leaves boxes that overlap nothing on the page', () => {
    const d = effectiveDepths([at('a', 0, 0, 1), at('b', 300, 0, 2)]);
    expect([d.get('a'), d.get('b')]).toEqual([0, 0]);
  });
  it('puts a box that lies behind another on the page behind it in 3D', () => {
    const d = effectiveDepths([at('top', 20, 10, 5), at('under', 0, 0, 1)]);
    expect(d.get('under')).toBe(0);
    expect(d.get('top')).toBe(L);
  });
  it('stacks a pile one layer per box, in the page order', () => {
    const d = effectiveDepths([at('c', 10, 10, 3), at('a', 0, 0, 1), at('b', 5, 5, 2)]);
    expect([d.get('a'), d.get('b'), d.get('c')]).toEqual([0, L, 2 * L]);
  });
  it('only counts boxes that really overlap (touching edges do not)', () => {
    const d = effectiveDepths([at('a', 0, 0, 1), at('b', 100, 0, 2), at('c', 0, 50, 3)]);
    expect([d.get('a'), d.get('b'), d.get('c')]).toEqual([0, 0, 0]);
  });
  it('lifts a box over the highest box under it that it overlaps', () => {
    const d = effectiveDepths([at('a', 0, 0, 1), at('b', 20, 0, 2), at('wide', 0, 0, 3, { w: 400 }), at('far', 300, 0, 4)]);
    expect(d.get('wide')).toBe(2 * L);
    expect(d.get('far')).toBe(3 * L); // it overlaps only `wide`, so it sits one layer over it
  });
  it('makes a frame the backdrop of what it holds, whatever their z numbers say', () => {
    const d = effectiveDepths([at('inside', 20, 20, 1, { frameId: 'f' }), frame('f', 0, 0, 400, 300, 9)]);
    expect(d.get('f')).toBe(0);
    expect(d.get('inside')).toBe(FRAME_THICKNESS + LAYER_GAP);
  });
  it('keeps a chosen depth, even 0, and lets the others follow around it', () => {
    const d = effectiveDepths([at('a', 0, 0, 1, { depth: 500 }), at('b', 10, 0, 2), at('c', 20, 0, 3, { depth: 0 })]);
    expect(d.get('a')).toBe(500);
    expect(d.get('c')).toBe(0);
    expect(d.get('b')).toBe(500 + L); // it lies over `a` on the page, so it rests on it wherever `a` was put
  });
  it('copes with nothing, and with a very large page', () => {
    expect(effectiveDepths([]).size).toBe(0);
    const many = Array.from({ length: 8100 }, (_, i) => at(`b${i}`, 0, 0, i));
    const d = effectiveDepths(many);
    expect(d.size).toBe(8100);
    expect([...d.values()].every((v) => v === 0)).toBe(true); // too many to work out: all stay on the page
  });
});

describe('choosing depth', () => {
  const boxes = () => [note('a', { z: 1 }), note('b', { z: 2 }), note('c', { z: 3, locked: true }), { ...note('f', { z: 0 }), type: 'frame' } as unknown as Block];
  it('chooses the depth of given boxes, never of frames or locked boxes', () => {
    const bs = boxes();
    expect(applyDepth(bs, ['a', 'c', 'f'], 120)).toBe(1);
    expect(bs.map((b) => b.depth)).toEqual([120, undefined, undefined, undefined]);
    expect(applyDepth(bs, ['a'], 120)).toBe(0); // already there
    expect(applyDepth(bs, ['a'], 0)).toBe(1);
    expect(bs[0].depth).toBe(0); // a chosen 0 stays: the box is flat on purpose
    expect(applyDepth(bs, ['a'], 1e9)).toBe(1);
    expect(bs[0].depth).toBe(DEPTH_MAX);
  });
  it('hands a box back to the page with null', () => {
    const bs = [note('a', { depth: 80 }), note('b')];
    expect(applyDepth(bs, ['a', 'b'], null)).toBe(1);
    expect(bs[0]).not.toHaveProperty('depth');
  });
  it('flattens everything to a chosen 0, and followStacking undoes every choice', () => {
    const bs = [note('a', { depth: 80 }), note('b', { depth: -80 }), note('c', { depth: 80, locked: true }), note('d')];
    expect(flattenDepth(bs)).toBe(3);
    expect(bs.map((b) => b.depth)).toEqual([0, 0, 80, 0]);
    expect(followStacking(bs)).toBe(3);
    expect(bs.map((b) => b.depth)).toEqual([undefined, undefined, 80, undefined]);
  });
});

describe('boxes as blocks', () => {
  it('makes a square into a block close to a cube, and keeps thin and huge boxes sensible', () => {
    expect(thicknessOf({ type: 'note', w: 160, h: 160 })).toBe(80);
    expect(thicknessOf({ type: 'note', w: 40, h: 20 })).toBe(MIN_THICKNESS);
    expect(thicknessOf({ type: 'note', w: 2000, h: 900 })).toBe(MAX_THICKNESS);
    expect(thicknessOf({ type: 'frame', w: 600, h: 400 })).toBe(FRAME_THICKNESS);
  });
  it('never makes blocks run into each other: a box resting on another starts where the one below ends', () => {
    const below = note('a', { x: 0, y: 0, w: 200, h: 160, z: 1 });
    const above = note('b', { x: 10, y: 10, w: 100, h: 80, z: 2 });
    const d = effectiveDepths([below, above]);
    expect(d.get('b')! - d.get('a')!).toBeGreaterThanOrEqual(thicknessOf(below));
  });
  const o = { x: 0, y: 0 };
  it('pushes the back face away from the viewer by the thickness', () => {
    const s = boxSolid(note('a', { x: 0, y: 0, w: 100, h: 40 }), o, 60);
    expect(s).toHaveLength(8);
    expect(s[0].z).toBe(-60);
    expect(s[4].z).toBe(-60 + thicknessOf({ type: 'note', w: 100, h: 40 }));
    expect([s[4].x, s[4].y]).toEqual([s[0].x, s[0].y]);
  });
  it('sees the front face from the front, the top from above, and the side it is turned toward', () => {
    const s = boxSolid(note('a', { x: 0, y: 0, w: 100, h: 40 }), o, 0);
    const names = (cam: Parameters<typeof cameraPosition>[0]) => visibleFaces(s, cameraPosition(cam)).map((f) => f.name).sort();
    expect(names({ yaw: 0, pitch: 0, dist: 900, target: { x: 50, y: -20, z: 0 } })).toEqual(['front']);
    const tilted = names({ yaw: 0, pitch: 0.6, dist: 900, target: { x: 50, y: -20, z: 0 } });
    expect(tilted).toContain('front');
    expect(tilted.filter((n) => n === 'top' || n === 'bottom')).toHaveLength(1); // looking down or up at it: one of the two
    const turned = names({ yaw: 0.8, pitch: 0, dist: 900, target: { x: 50, y: -20, z: 0 } });
    expect(turned).toContain('front');
    expect(turned.filter((n) => n === 'left' || n === 'right')).toHaveLength(1); // turned to one side: that side shows
    expect(names({ yaw: Math.PI, pitch: 0, dist: 900, target: { x: 50, y: -20, z: 0 } })).toEqual(['back']);
  });
  it('never shows more than three faces of a block at once, and faces are all defined', () => {
    expect(FACES).toHaveLength(6);
    const s = boxSolid(note('a', { x: 0, y: 0, w: 100, h: 40 }), o, 0);
    for (const yaw of [-2, -1, 0, 0.5, 1.2, 2.5]) for (const pitch of [-1, -0.4, 0, 0.4, 1]) {
      const n = visibleFaces(s, cameraPosition({ yaw, pitch, dist: 900, target: { x: 50, y: -20, z: 0 } })).length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
    }
  });
  it('knows where the camera is: dist from its target, and it looks at it', () => {
    const cam = { yaw: 0.7, pitch: 0.3, dist: 900, target: { x: 10, y: 20, z: 30 } };
    const eye = cameraPosition(cam);
    expect(Math.hypot(eye.x - 10, eye.y - 20, eye.z - 30)).toBeCloseTo(900, 6);
    const at = project(cam.target, cam, 800, 600)!;
    expect([Math.round(at.x), Math.round(at.y)]).toEqual([400, 300]);
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

describe('camera movement', () => {
  const W = 800, H = 600;
  const cam = { yaw: 0.45, pitch: 0.22, dist: 1400, target: { x: 10, y: -20, z: 30 } };
  it('zooms toward the pointer: the point under it stays under it', async () => {
    const { zoomAt } = await import('../src/lib/spaceCamera');
    const sx = 620, sy = 150;
    const under = unproject(sx, sy, cam.dist, cam, W, H);
    const next = zoomAt(cam, 0.5, sx, sy, W, H);
    expect(next.dist).toBeCloseTo(700);
    const p = project(under, next, W, H)!;
    expect(p.x).toBeCloseTo(sx, 3);
    expect(p.y).toBeCloseTo(sy, 3);
  });
  it('zooming at the centre only changes the distance, and respects the limits', async () => {
    const { zoomAt } = await import('../src/lib/spaceCamera');
    const n = zoomAt(cam, 0.5, W / 2, H / 2, W, H);
    expect(n.target.x).toBeCloseTo(cam.target.x); expect(n.target.y).toBeCloseTo(cam.target.y); expect(n.target.z).toBeCloseTo(cam.target.z);
    expect(zoomAt(cam, 1e-6, 100, 100, W, H).dist).toBeGreaterThanOrEqual(120);
    expect(zoomAt(cam, 1e6, 100, 100, W, H).dist).toBeLessThanOrEqual(6000);
  });
  it('slides so the world follows the pointer', async () => {
    const { panBy } = await import('../src/lib/spaceCamera');
    const point = { x: 50, y: 40, z: 0 };
    const before = project(point, cam, W, H)!;
    const after = project(point, panBy(cam, 60, -25, W, H), W, H)!;
    expect(Math.abs(after.x - before.x - 60)).toBeLessThan(2); // exact on the plane through the pivot, a little off elsewhere (perspective)
    expect(Math.abs(after.y - before.y + 25)).toBeLessThan(2);
  });
  it('turns the short way round, never over the top', async () => {
    const { angleDiff, glide, orbitBy } = await import('../src/lib/spaceCamera');
    expect(angleDiff(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDiff(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    const g = glide({ ...cam, yaw: 3 }, { ...cam, yaw: -3 }, 0.5);
    expect(Math.abs(angleDiff(g.yaw, 3.141))).toBeLessThan(0.2);
    expect(orbitBy(cam, 0, 1e6).pitch).toBeLessThanOrEqual(1.45);
  });
  it('knows its named views, and which one the camera is in', async () => {
    const { VIEW_NAMES, viewCamera, viewOf } = await import('../src/lib/spaceCamera');
    for (const n of VIEW_NAMES) expect(viewOf(viewCamera(cam, n))).toBe(n);
    expect(viewOf({ ...cam, yaw: 1.2 })).toBeNull();
    expect(viewCamera(cam, 'front').dist).toBe(cam.dist);
  });
  it('stops turning after a flick', async () => {
    const { spinStep } = await import('../src/lib/spaceCamera');
    let v: { x: number; y: number } | null = { x: 20, y: 0 };
    let n = 0;
    while (v && n < 500) (v = spinStep(v)), n++;
    expect(v).toBeNull();
    expect(n).toBeLessThan(120);
  });
});

describe('the orientation cube', () => {
  it('shows only the front face when looking at the page head-on, and a face is flat to you when you look from it', async () => {
    const { cubeFaces, FACE_VIEW } = await import('../src/lib/spaceCamera');
    expect(cubeFaces({ yaw: 0, pitch: 0 }, 20).map((f) => f.name)).toEqual(['front']);
    for (const name of Object.keys(FACE_VIEW) as (keyof typeof FACE_VIEW)[]) {
      const faces = cubeFaces({ ...FACE_VIEW[name], pitch: FACE_VIEW[name].pitch * 0.9999 }, 20);
      expect(faces[0].name === name || faces.some((f) => f.name === name)).toBe(true);
      expect(faces.find((f) => f.name === name)!.poly.length).toBe(4);
    }
  });
  it('shows three faces from an angle (the default view) and turns with the camera', async () => {
    const { cubeFaces } = await import('../src/lib/spaceCamera');
    const names = cubeFaces({ yaw: 0.45, pitch: -0.25 }, 20).map((f) => f.name).sort();
    expect(names).toHaveLength(3);
    expect(names).toContain('front');
    const turned = cubeFaces({ yaw: 0.45 + Math.PI, pitch: -0.25 }, 20).map((f) => f.name);
    expect(turned).toContain('back');
  });
});

describe('stacking on big pages', () => {
  const brute = (blocks: Block[]) => {
    const out = new Map<string, number>();
    const done: { b: Block; depth: number }[] = [];
    const ov = (a: Block, b: Block) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + (b.h ?? 40) && b.y < a.y + (a.h ?? 40);
    for (const b of paintOrderOf(blocks)) {
      let d = 0;
      for (const o of done) if (ov(b, o.b)) d = Math.max(d, o.depth + thicknessOf(o.b) + LAYER_GAP);
      out.set(b.id, clampDepth(d));
      done.push({ b, depth: clampDepth(d) });
    }
    return out;
  };
  let paintOrderOf: (b: Block[]) => Block[];
  it('gives the same depths as comparing every pair, also for huge and far-away boxes', async () => {
    paintOrderOf = (await import('../src/lib/frames')).paintOrder as never;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const blocks: Block[] = Array.from({ length: 300 }, (_, i) => note(`b${i}`, { x: Math.round(rnd() * 3000 - 500), y: Math.round(rnd() * 2000), w: 40 + Math.round(rnd() * 300), h: 40 + Math.round(rnd() * 200), z: i }));
    blocks.push(note('huge', { x: -50000, y: -50000, w: 200000, h: 200000, z: 301 }), note('far', { x: 9e6, y: 9e6, w: 100, h: 100, z: 302 }));
    const fast = effectiveDepths(blocks);
    const slow = brute(blocks);
    for (const b of blocks) expect(fast.get(b.id)).toBe(slow.get(b.id));
  });
  it('handles thousands of boxes quickly', () => {
    const blocks: Block[] = Array.from({ length: 5000 }, (_, i) => note(`b${i}`, { x: (i % 100) * 150, y: Math.floor(i / 100) * 90, w: 200, h: 60, z: i }));
    const t = Date.now();
    const d = effectiveDepths(blocks);
    expect(d.size).toBe(5000);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('remembering the 3D camera', () => {
  it('reads back a stored camera and limits every number', async () => {
    const { parseCamera } = await import('../src/lib/spaceCamera');
    const c = parseCamera(JSON.stringify({ yaw: 0.5, pitch: 9, dist: 1, target: { x: 1, y: 2, z: 3 } }))!;
    expect(c.pitch).toBeLessThanOrEqual(1.45);
    expect(c.dist).toBeGreaterThanOrEqual(120);
    expect(c.target).toEqual({ x: 1, y: 2, z: 3 });
  });
  it('refuses anything else', async () => {
    const { parseCamera } = await import('../src/lib/spaceCamera');
    for (const bad of [null, undefined, 'x', '{}', '{"yaw":"a"}', '[]', JSON.stringify({ yaw: 1, pitch: 1, dist: 1, target: { x: 1, y: 1 } })]) expect(parseCamera(bad as never)).toBeNull();
  });
});
