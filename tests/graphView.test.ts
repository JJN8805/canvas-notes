import { describe, expect, it } from 'vitest';
import { buildGraph, DEFAULT_GRAPH_OPTIONS, matchIds, nodeRadius, tagNodeId } from '../src/lib/graphModel';
import { ALPHA_MIN, bounds, createSim, DEFAULT_FORCES, reheat, settle, stepSim } from '../src/lib/graphSim';
import { buildScene, matchNodes, sceneRadius } from '../src/lib/scene3d';
import { buildTree, clampDist, clampPitch, coneLayout, DEFAULT_CAMERA, easeCamera, flatten, frame, pick, project, segmentDistance, unproject, visible } from '../src/lib/tree3d';
import type { Block, Group, Page } from '../src/types';

const note = (id: string, html: string, o: Partial<Block> = {}): Block => ({ id, type: 'note', style: 'text', x: 0, y: 0, w: 100, h: 40, z: 1, html, ...o }) as Block;
const page = (id: string, title: string, blocks: Block[] = [], o: Partial<Page> = {}): Page => ({ id, title, groupId: null, tags: [], blocks, arrows: [], created: 1, updated: 1, rev: 1, ...o });
const map = (...ps: Page[]) => Object.fromEntries(ps.map((p) => [p.id, p]));
const group = (id: string, name: string, parentId: string | null = null): Group => ({ id, name, color: 'teal', parentId });

describe('the graph model', () => {
  const pages = map(
    page('a', 'Alpha', [note('1', '[[Beta]]')], { tags: ['x', 'y'], groupId: 'g1' }),
    page('b', 'Beta', [], { tags: ['x'], groupId: 'g1' }),
    page('c', 'Gamma'),
    page('k', 'Kay', [], { kind: 'card', tags: ['y'] }),
  );
  const groups = [group('g1', 'Work')];
  it('has pages and cards, with links counted both ways', () => {
    const g = buildGraph(pages, groups, DEFAULT_GRAPH_OPTIONS);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'k']);
    expect(g.nodes.find((n) => n.id === 'a')).toMatchObject({ links: 1, groupId: 'g1', kind: 'page' });
    expect(g.edges).toMatchObject([{ from: 'a', to: 'b', kind: 'text' }]);
  });
  it('can show tags as nodes joined to the pages that use them, and counts those links', () => {
    const g = buildGraph(pages, groups, { ...DEFAULT_GRAPH_OPTIONS, tags: true });
    expect(g.nodes.find((n) => n.id === tagNodeId('x'))).toMatchObject({ kind: 'tag', title: '#x', links: 2 });
    expect(g.edges.filter((e) => e.kind === 'tag')).toHaveLength(4); // a-x, a-y, b-x, k-y
    expect(g.nodes.find((n) => n.id === 'a')!.links).toBe(3);
  });
  it('can hide what nothing is joined to', () => {
    expect(buildGraph(pages, groups, { ...DEFAULT_GRAPH_OPTIONS, orphans: false }).nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(buildGraph(pages, groups, { ...DEFAULT_GRAPH_OPTIONS, orphans: false, tags: true }).nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'k', 'tag:x', 'tag:y']);
  });
  it('narrows to a group or a tag', () => {
    expect(buildGraph(pages, groups, { ...DEFAULT_GRAPH_OPTIONS, groupId: 'g1' }).nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(buildGraph(pages, groups, { ...DEFAULT_GRAPH_OPTIONS, tag: 'y' }).nodes.map((n) => n.id).sort()).toEqual(['a', 'k']);
  });
  it('shows only what is near one page', () => {
    const g = buildGraph(pages, groups, { ...DEFAULT_GRAPH_OPTIONS, here: 'a', depth: 1 });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
  it('finds nodes by title, ignoring case, and says nothing when nothing is typed', () => {
    const g = buildGraph(pages, groups, DEFAULT_GRAPH_OPTIONS);
    expect([...matchIds(g, ' GAM ')!]).toEqual(['c']);
    expect(matchIds(g, '  ')).toBeNull();
  });
  it('sizes a dot by its links, within limits', () => {
    expect(nodeRadius(0)).toBe(4);
    expect(nodeRadius(4)).toBeGreaterThan(nodeRadius(1));
    expect(nodeRadius(10000)).toBeLessThanOrEqual(16);
    expect(nodeRadius(4, 2)).toBeCloseTo(nodeRadius(4) * 2);
  });
});

describe('the force layout', () => {
  const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, r: 6 }));
  it('is the same every time', () => {
    const run = () => {
      const s = createSim(nodes(12), [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }]);
      settle(s, DEFAULT_FORCES);
      return s.nodes.map((n) => [Math.round(n.x * 1000), Math.round(n.y * 1000), Math.round(n.z * 1000)]);
    };
    expect(run()).toEqual(run());
  });
  it('settles, and every position is a real number', () => {
    const s = createSim(nodes(40), Array.from({ length: 39 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })));
    const steps = settle(s, DEFAULT_FORCES, 1000);
    expect(steps).toBeLessThan(1000);
    expect(s.alpha).toBeLessThan(ALPHA_MIN * 1.01);
    expect(stepSim(s, DEFAULT_FORCES)).toBe(false);
    expect(s.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z))).toBe(true);
  });
  it('linked nodes end up near the link length, unlinked ones further apart', () => {
    const s = createSim(nodes(4), [{ from: 'n0', to: 'n1' }]);
    settle(s, { ...DEFAULT_FORCES, center: 0 });
    const d = (a: string, b: string) => {
      const x = s.nodes.find((n) => n.id === a)!;
      const y = s.nodes.find((n) => n.id === b)!;
      return Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z);
    };
    expect(d('n0', 'n1')).toBeLessThan(d('n2', 'n3'));
    expect(d('n0', 'n1')).toBeGreaterThan(20);
  });
  it('keeps a held node where it is, and moves the others', () => {
    const s = createSim(nodes(5), [{ from: 'n0', to: 'n1' }, { from: 'n0', to: 'n2' }]);
    s.nodes[0].fx = 300;
    s.nodes[0].fy = -200;
    s.nodes[0].fz = 50;
    settle(s, DEFAULT_FORCES);
    expect([s.nodes[0].x, s.nodes[0].y, s.nodes[0].z]).toEqual([300, -200, 50]);
    expect(Math.hypot(s.nodes[1].x - 300, s.nodes[1].y + 200, s.nodes[1].z - 50)).toBeLessThan(400);
  });
  it('heats up again after a change, and keeps old places for nodes that were already there', () => {
    const s = createSim(nodes(3), []);
    settle(s, DEFAULT_FORCES);
    expect(s.alpha).toBeLessThan(ALPHA_MIN * 1.01);
    reheat(s);
    expect(stepSim(s, DEFAULT_FORCES)).toBe(true);
    const before = new Map(s.nodes.map((n) => [n.id, { x: n.x, y: n.y, z: n.z }]));
    const again = createSim(nodes(4), [], before);
    expect([again.nodes[1].x, again.nodes[1].y, again.nodes[1].z]).toEqual([before.get('n1')!.x, before.get('n1')!.y, before.get('n1')!.z]);
  });
  it('copes with nothing, one node, nodes on top of each other, and a link to a missing node', () => {
    expect(settle(createSim([], []), DEFAULT_FORCES)).toBeGreaterThanOrEqual(0);
    const one = createSim(nodes(1), []);
    settle(one, DEFAULT_FORCES);
    expect(Number.isFinite(one.nodes[0].x)).toBe(true);
    const same = createSim(nodes(3), [{ from: 'n0', to: 'ghost' }]);
    same.nodes.forEach((n) => ((n.x = 5), (n.y = 5), (n.z = 5)));
    settle(same, DEFAULT_FORCES);
    expect(new Set(same.nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)},${Math.round(n.z)}`)).size).toBe(3);
    expect(same.links).toHaveLength(0);
  });
  it('spreads the starting layout through all three dimensions', () => {
    const s = createSim(nodes(30), []);
    const spread = (f: (n: (typeof s.nodes)[number]) => number) => Math.max(...s.nodes.map(f)) - Math.min(...s.nodes.map(f));
    expect(spread((n) => n.x)).toBeGreaterThan(20);
    expect(spread((n) => n.y)).toBeGreaterThan(20);
    expect(spread((n) => n.z)).toBeGreaterThan(20);
  });
  it('measures the picture', () => {
    expect(bounds([])).toEqual({ minX: -50, minY: -50, maxX: 50, maxY: 50 });
    const s = createSim(nodes(2), []);
    s.nodes[0].x = -10; s.nodes[1].x = 30; s.nodes[0].y = s.nodes[1].y = 0;
    expect(bounds(s.nodes)).toMatchObject({ minX: -16, maxX: 36 });
  });
});

describe('the 3D hierarchy', () => {
  const groups = [group('g1', 'Work'), group('g2', 'Plans', 'g1'), group('loop1', 'L1', 'loop2'), group('loop2', 'L2', 'loop1')];
  const pages = map(
    page('a', 'Alpha', [note('h1', '<h1>Intro</h1><h2>Detail</h2><h1>Next</h1>')], { groupId: 'g2' }),
    page('b', 'Beta', [], { groupId: 'g1' }),
    page('c', 'Loose'),
    page('t', 'Tpl', [], { kind: 'template' }),
    page('k', 'Kay', [], { kind: 'card' }),
    page('d', 'Day', [], { dailyDate: '2026-11-01' }),
  );
  const tree = buildTree(pages, groups);
  it('nests groups and puts each page under its group, with headings under the page', () => {
    const by = (id: string) => flatten(tree).find((n) => n.id === id)!;
    expect(tree).toMatchObject({ kind: 'root', depth: 0 });
    expect(by('g:g2').depth).toBe(2);
    expect(by('p:a').depth).toBe(3);
    expect(by('p:c').depth).toBe(1);
    const heads = by('p:a').children;
    expect(heads.map((h) => h.label)).toEqual(['Intro', 'Next']);
    expect(heads[0].children.map((h) => h.label)).toEqual(['Detail']); // an H2 sits under the H1 before it
  });
  it('leaves out templates, cards and daily pages, and survives a loop of groups', () => {
    const ids = flatten(tree).map((n) => n.id);
    expect(ids).not.toContain('p:t');
    expect(ids).not.toContain('p:k');
    expect(ids).not.toContain('p:d');
    expect(ids).toContain('g:loop1');
    expect(ids).toContain('g:loop2');
  });
  it('can leave headings out, and cuts a huge library instead of freezing', () => {
    expect(flatten(buildTree(pages, groups, { headings: false })).some((n) => n.kind === 'heading')).toBe(false);
    const many = map(...Array.from({ length: 50 }, (_, i) => page(`p${i}`, `P${i}`)));
    expect(flatten(buildTree(many, [], { headings: true, maxNodes: 10 })).length).toBeLessThanOrEqual(10);
  });
  it('closing a branch hides what is under it', () => {
    expect(visible(tree, new Set()).length).toBe(flatten(tree).length);
    const v = visible(tree, new Set(['g:g1'])).map((n) => n.id);
    expect(v).toContain('g:g1');
    expect(v).not.toContain('g:g2');
    expect(v).not.toContain('p:a');
  });
  it('lays out each level lower than the one above, with no two nodes in the same place', () => {
    const pos = coneLayout(tree);
    expect(pos.get('root')).toEqual({ x: 0, y: 0, z: 0 });
    expect(pos.get('g:g1')!.y).toBeLessThan(pos.get('root')!.y);
    expect(pos.get('p:a')!.y).toBeLessThan(pos.get('g:g2')!.y);
    const spots = new Set([...pos.values()].map((p) => `${p.x.toFixed(2)},${p.y},${p.z.toFixed(2)}`));
    expect(spots.size).toBe(pos.size);
    expect([...pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true);
  });
  it('gives a bigger branch a wider wedge', () => {
    const wide = map(...Array.from({ length: 9 }, (_, i) => page(`w${i}`, `W${i}`, [], { groupId: 'big' })), page('s', 'S', [], { groupId: 'small' }));
    const t = buildTree(wide, [group('big', 'Big'), group('small', 'Small')], { headings: false });
    const pos = coneLayout(t);
    const spread = (ids: string[]) => {
      const a = ids.map((id) => Math.atan2(pos.get(id)!.z, pos.get(id)!.x));
      return Math.max(...a) - Math.min(...a);
    };
    expect(spread(Array.from({ length: 9 }, (_, i) => `p:w${i}`))).toBeGreaterThan(0.5);
  });
  it('a closed branch no longer takes room for what is inside it', () => {
    const open = coneLayout(tree);
    const shut = coneLayout(tree, new Set(['g:g1']));
    expect(shut.has('p:a')).toBe(false);
    expect(open.has('p:a')).toBe(true);
  });
});

describe('the camera', () => {
  const W = 800, H = 600;
  it('puts the point it looks at in the middle, and nearer things bigger', () => {
    const c = { ...DEFAULT_CAMERA, target: { x: 0, y: 0, z: 0 } };
    const mid = project({ x: 0, y: 0, z: 0 }, c, W, H)!;
    expect([Math.round(mid.x), Math.round(mid.y)]).toEqual([400, 300]);
    const c0 = { ...c, yaw: 0, pitch: 0 };
    const near = project({ x: 100, y: 0, z: -200 }, c0, W, H)!;
    const far = project({ x: 100, y: 0, z: 200 }, c0, W, H)!;
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.depth).toBeLessThan(far.depth);
    expect(near.x - 400).toBeGreaterThan(far.x - 400);
  });
  it('up is up, and turning moves things sideways', () => {
    const c = { ...DEFAULT_CAMERA, target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };
    expect(project({ x: 0, y: 100, z: 0 }, c, W, H)!.y).toBeLessThan(300);
    const turned = project({ x: 100, y: 0, z: 0 }, { ...c, yaw: Math.PI / 2 }, W, H)!;
    expect(Math.abs(turned.x - 400)).toBeLessThan(1); // a quarter turn puts it straight ahead or behind
  });
  it('does not draw what is behind the camera', () => {
    expect(project({ x: 0, y: 0, z: -5000 }, { ...DEFAULT_CAMERA, target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 }, W, H)).toBeNull();
  });
  it('picks the nearest dot under the pointer, preferring the one in front', () => {
    const at = (x: number, y: number, depth: number) => ({ x, y, depth, scale: 1 });
    const items = [{ id: 'far', at: at(100, 100, 900), r: 10 }, { id: 'near', at: at(104, 100, 500), r: 10 }, { id: 'away', at: at(300, 300, 100), r: 10 }];
    expect(pick(items, 101, 100)).toBe('near');
    expect(pick(items, 500, 500)).toBeNull();
    expect(pick([], 0, 0)).toBeNull();
  });
  it('keeps pitch and distance sane, and frames what is there', () => {
    expect(clampPitch(5)).toBeLessThan(Math.PI / 2);
    expect(clampPitch(-5)).toBeGreaterThan(-Math.PI / 2);
    expect(clampDist(1)).toBe(120);
    expect(clampDist(1e9)).toBe(6000);
    const f = frame([{ x: -300, y: 0, z: 0 }, { x: 300, y: -240, z: 100 }]);
    expect(f.target).toEqual({ x: 0, y: -120, z: 50 });
    expect(f.dist).toBeGreaterThan(900);
    expect(frame([]).dist).toBe(DEFAULT_CAMERA.dist);
  });
});

describe('the graph view settings', () => {
  it('start from sensible defaults, and repair anything odd', async () => {
    const { cleanGraphPrefs, DEFAULT_GRAPH_PREFS } = await import('../src/lib/graphPrefs');
    expect(cleanGraphPrefs(null)).toEqual(DEFAULT_GRAPH_PREFS);
    expect(cleanGraphPrefs('junk')).toEqual(DEFAULT_GRAPH_PREFS);
    const odd = cleanGraphPrefs({ layout: 'x', cards: 'yes', labelZoom: 99, nodeScale: -3, forces: { repel: 1e9, distance: NaN, center: 'a' }, orphans: false });
    expect(odd).toMatchObject({ layout: 'network', cards: true, labelZoom: 3, nodeScale: 0.5, orphans: false });
    expect(odd.forces).toMatchObject({ repel: 4, distance: DEFAULT_GRAPH_PREFS.forces.distance, center: DEFAULT_GRAPH_PREFS.forces.center });
    expect(cleanGraphPrefs({ layout: 'tree' }).layout).toBe('tree');
  });
  it('read what older versions saved (`tab`, `links3d`)', async () => {
    const { cleanGraphPrefs } = await import('../src/lib/graphPrefs');
    expect(cleanGraphPrefs({ tab: 'tree', links3d: false })).toMatchObject({ layout: 'tree', showLinks: false });
    expect(cleanGraphPrefs({ tab: 'graph' }).layout).toBe('network');
  });
});

describe('the combined scene', () => {
  const pages = map(
    page('a', 'Alpha', [note('1', '<h1>Intro</h1><p>[[Beta]]</p>', { links: [{ page: 'c' }] })], { tags: ['x'], groupId: 'g1' }),
    page('b', 'Beta', [], { tags: ['x'], groupId: 'g2' }),
    page('c', 'Gamma', [], { groupId: 'g2' }),
    page('o', 'Orphan'),
    page('k', 'Kay', [], { kind: 'card', tags: ['x'] }),
  );
  const groups = [group('g1', 'Work'), group('g2', 'Home'), group('g3', 'Empty')];
  const opts = { ...DEFAULT_GRAPH_OPTIONS, headings: false };
  const ids = (t: ReturnType<typeof buildScene>['tree']) => flatten(t).map((n) => n.id);

  it('holds the library, groups, pages and cards in one tree, with the links as lines between them', () => {
    const s = buildScene(pages, groups, opts);
    expect(ids(s.tree)).toEqual(expect.arrayContaining(['root', 'g:g1', 'g:g2', 'g:g3', 'p:a', 'p:b', 'p:c', 'p:o', 'c:k', 'sec:cards']));
    expect(s.edges.map((e) => `${e.from}>${e.to}:${e.kind}`).sort()).toEqual(['p:a>p:b:text', 'p:a>p:c:box']);
  });
  it('puts tags in a section of their own and joins them to what uses them', () => {
    const s = buildScene(pages, groups, { ...opts, tags: true });
    expect(ids(s.tree)).toEqual(expect.arrayContaining(['sec:tags', 'tag:x']));
    expect(s.edges.filter((e) => e.kind === 'tag').map((e) => `${e.from}>${e.to}`).sort()).toEqual(['c:k>tag:x', 'p:a>tag:x', 'p:b>tag:x']);
    expect(flatten(s.tree).find((n) => n.id === 'tag:x')).toMatchObject({ kind: 'tag', links: 3 });
  });
  it('puts the headings under their pages when asked', () => {
    expect(ids(buildScene(pages, groups, opts).tree).some((i) => i.startsWith('h:'))).toBe(false);
    expect(ids(buildScene(pages, groups, { ...opts, headings: true }).tree).some((i) => i.startsWith('h:a:'))).toBe(true);
  });
  it('filters: orphans, a group, a tag, and the neighbourhood of a page; groups left empty go', () => {
    const noOrphans = buildScene(pages, groups, { ...opts, orphans: false });
    expect(ids(noOrphans.tree)).not.toContain('p:o');
    expect(ids(noOrphans.tree)).not.toContain('g:g3');
    expect(ids(noOrphans.tree)).toContain('p:a');
    const home = buildScene(pages, groups, { ...opts, groupId: 'g2' });
    expect(ids(home.tree).filter((i) => i.startsWith('p:'))).toEqual(expect.arrayContaining(['p:b', 'p:c']));
    expect(ids(home.tree)).not.toContain('p:a');
    expect(ids(home.tree)).not.toContain('g:g1');
    const tagged = buildScene(pages, groups, { ...opts, tag: 'x' });
    expect(ids(tagged.tree).filter((i) => i.startsWith('p:')).sort()).toEqual(['p:a', 'p:b']);
    const near = buildScene(pages, groups, { ...opts, here: 'c', depth: 1 });
    expect(ids(near.tree).filter((i) => i.startsWith('p:')).sort()).toEqual(['p:a', 'p:c']);
  });
  it('keeps the library even when nothing is left', () => {
    const s = buildScene({}, [], opts);
    expect(ids(s.tree)).toEqual(['root']);
    expect(s.edges).toEqual([]);
  });
  it('finds nodes by name, and sizes dots by kind and links', () => {
    const s = buildScene(pages, groups, opts);
    expect([...matchNodes(flatten(s.tree), 'ALP')!]).toEqual(['p:a']);
    expect(matchNodes(flatten(s.tree), '  ')).toBeNull();
    expect(sceneRadius({ kind: 'root' })).toBeGreaterThan(sceneRadius({ kind: 'group' }));
    expect(sceneRadius({ kind: 'page', links: 9 })).toBeGreaterThan(sceneRadius({ kind: 'page', links: 0 }));
    expect(sceneRadius({ kind: 'page', links: 1e9 })).toBeLessThan(15);
    expect(sceneRadius({ kind: 'heading' }, 99)).toBe(sceneRadius({ kind: 'heading' }, 2.5));
  });
});

describe('dragging and picking in 3D', () => {
  it('unproject undoes project, for any camera', () => {
    const cams = [DEFAULT_CAMERA, { yaw: -1.2, pitch: 0.9, dist: 400, target: { x: 30, y: -50, z: 80 } }, { yaw: 2.5, pitch: -0.7, dist: 2000, target: { x: 0, y: 0, z: 0 } }];
    for (const c of cams) {
      for (const p of [{ x: 10, y: 20, z: 30 }, { x: -200, y: 100, z: 60 }, { x: 0, y: -120, z: 0 }]) {
        const at = project(p, c, 800, 600)!;
        const back = unproject(at.x, at.y, at.depth, c, 800, 600);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
        expect(back.z).toBeCloseTo(p.z, 6);
      }
    }
  });
  it('measures how far a point is from a line segment', () => {
    expect(segmentDistance(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(segmentDistance(-4, 3, 0, 0, 10, 0)).toBe(5); // beyond the end: distance to the end
    expect(segmentDistance(3, 4, 0, 0, 0, 0)).toBe(5); // a segment that is a point
  });
  it('eases a camera toward another without overshooting', () => {
    const to = { ...DEFAULT_CAMERA, dist: 100, target: { x: 10, y: 10, z: 10 } };
    const half = easeCamera({ ...DEFAULT_CAMERA, dist: 300, target: { x: 0, y: 0, z: 0 } }, to, 0.5);
    expect(half.dist).toBe(200);
    expect(half.target).toEqual({ x: 5, y: 5, z: 5 });
    expect(half.yaw).toBe(DEFAULT_CAMERA.yaw);
  });
});
