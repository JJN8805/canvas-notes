import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Group } from '../../../types';
import type { GraphPrefs } from '../../../lib/graphPrefs';
import { createSim, reheat, settle, stepSim, ALPHA_MIN, type Sim } from '../../../lib/graphSim';
import { matchNodes, sceneRadius, type SceneEdge } from '../../../lib/scene3d';
import {
  DEFAULT_CAMERA, DEFAULT_LAYOUT, FOV, clampDist, clampPitch, coneLayout, easeCamera, flatten, frame, pick, project, segmentDistance, unproject, visible,
  type Camera, type P3, type Projected, type TNode,
} from '../../../lib/tree3d';
import { colorVar } from '../../../lib/util';
import { TreeList } from './TreeList';

const MORPH_MS = 700; // how long the dots take to glide from one layout to the other
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const EDGE_REACH = 6; // pixels from a line that still counts as on it

/** `var(--c-teal)` as the colour the canvas needs (a canvas cannot read CSS variables itself). */
function resolve(el: Element, v: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? getComputedStyle(el).getPropertyValue(m[1]).trim() || '#888' : v;
}

interface Props {
  tree: TNode;
  edges: SceneEdge[];
  groups: Group[];
  prefs: GraphPrefs;
  here: string | null;
  query: string;
  onOpen: (n: TNode) => void;
  onEdge: (e: SceneEdge | null) => void;
  selectedEdge: SceneEdge | null;
}

/** What a browser check can ask the canvas: where everything is on screen (the picture itself has no elements to find). */
export interface ScreenInfo {
  layout: GraphPrefs['layout'];
  alpha: number;
  nodes: { id: string; label: string; kind: TNode['kind']; x: number; y: number; r: number }[];
  edges: { from: string; to: string; kind: SceneEdge['kind']; x: number; y: number }[];
  hierarchyLines: number;
}

const sameEdge = (a: SceneEdge | null, b: SceneEdge) => !!a && a.from === b.from && a.to === b.to && a.kind === b.kind;

/** A point along a line between two screen points that bows upward by `bow` (0 = straight), for t from 0 to 1. */
const along = (a: { x: number; y: number }, b: { x: number; y: number }, bow: number, t: number) => {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2 - Math.hypot(a.x - b.x, a.y - b.y) * bow;
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y };
};

/**
 * The whole library in one 3D picture. The same dots can be arranged as a **network** (a live force layout: dots push apart, links pull
 * together, drag a dot and the rest follow) or as the **hierarchy** (library → groups → pages → headings as a cone), and switching glides
 * them from one to the other. Drag the background to turn, scroll to zoom, Shift+drag to move, click a dot to open it (a group folds).
 */
export function Scene3D({ tree, edges, groups, prefs, here, query, onOpen, onEdge, selectedEdge }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ ...DEFAULT_CAMERA });
  const raf = useRef(0);
  const hover = useRef<{ node: string | null; edge: SceneEdge | null }>({ node: null, edge: null });
  const orbit = useRef<{ x: number; y: number; yaw: number; pitch: number; target: P3; shift: boolean; moved: number } | null>(null);
  const grab = useRef<{ id: string; depth: number; moved: number } | null>(null);
  const sim = useRef<{ sim: Sim; byId: Map<string, Sim['nodes'][number]> } | null>(null);
  const pos = useRef(new Map<string, P3>());
  const morph = useRef<{ from: Map<string, P3>; t0: number } | null>(null);
  const follow = useRef(true); // the camera keeps the whole picture in view until the person moves it
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const network = prefs.layout === 'network';
  const hier = !network || prefs.hierarchy;
  const nodes = useMemo(
    () => visible(tree, closed).filter((n) => hier || !(n.kind === 'root' || n.kind === 'group' || n.kind === 'heading')),
    [tree, closed, hier],
  );
  const shownIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const parentOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of flatten(tree)) for (const c of n.children) m.set(c.id, n.id);
    return m;
  }, [tree]);
  const lines = useMemo(() => (hier ? nodes.filter((n) => parentOf.has(n.id) && shownIds.has(parentOf.get(n.id)!)).map((n) => ({ from: parentOf.get(n.id)!, to: n.id })) : []), [nodes, parentOf, shownIds, hier]);
  const links = useMemo(() => (prefs.showLinks ? edges.filter((e) => shownIds.has(e.from) && shownIds.has(e.to)) : []), [edges, shownIds, prefs.showLinks]);
  const treePos = useMemo(() => coneLayout(tree, closed, DEFAULT_LAYOUT), [tree, closed]);
  const matches = useMemo(() => matchNodes(nodes, query), [nodes, query]);
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
    for (const e of links) (add(e.from, e.to), add(e.to, e.from));
    return m;
  }, [links]);
  const groupColour = useMemo(() => new Map(groups.map((g) => [`g:${g.id}`, g.color])), [groups]);
  const dataRef = useRef({ nodes, links, lines, treePos, matches, selected, parentOf, neighbours, here, prefs, network, hier, closed, selectedEdge, groupColour });
  dataRef.current = { nodes, links, lines, treePos, matches, selected, parentOf, neighbours, here, prefs, network, hier, closed, selectedEdge, groupColour };

  /** Everything on screen, with where it is: used both to draw and to find what the pointer is over. */
  const projectAll = useCallback((w: number, h: number) => {
    const d = dataRef.current;
    const out: { node: TNode; at: Projected; r: number }[] = [];
    for (const node of d.nodes) {
      const p = pos.current.get(node.id);
      const at = p && project(p, cam.current, w, h);
      if (at) out.push({ node, at, r: Math.max(2, sceneRadius(node, d.prefs.nodeScale) * at.scale * 0.95) });
    }
    return out;
  }, []);

  /* ---- drawing ---- */
  const draw = useCallback(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const d = dataRef.current;
    const colours = new Map<string, string>();
    const col = (v: string) => colours.get(v) ?? (colours.set(v, resolve(el, v)), colours.get(v)!);
    const ink = col('var(--ink)');
    const rule = col('var(--rule)');
    const accent = col('var(--accent)');
    const items = projectAll(w, h).sort((a, b) => b.at.depth - a.at.depth); // far first, so near things paint over them
    const at = new Map(items.map((i) => [i.node.id, i]));

    // What the pointer is on, and what that touches: those stay bright, the rest fades.
    const focus = hover.current.node ?? d.selected;
    const lit = new Set<string>();
    if (focus) {
      lit.add(focus);
      d.neighbours.get(focus)?.forEach((n) => lit.add(n));
      for (let id = d.parentOf.get(focus); id; id = d.parentOf.get(id)) lit.add(id);
    }
    const fade = (on: boolean) => (focus && !on ? 0.12 : 1);

    // A faint ring for each level, so the layers of the hierarchy can be told apart.
    if (!d.network) {
      const levelR = new Map<number, number>();
      for (const n of d.nodes) {
        const p = d.treePos.get(n.id);
        if (p) levelR.set(n.depth, Math.max(levelR.get(n.depth) ?? 0, Math.hypot(p.x, p.z)));
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = rule;
      ctx.globalAlpha = 0.45;
      for (const [depth, radius] of levelR) {
        if (!radius) continue;
        ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          const p = project({ x: Math.cos(a) * radius, y: -depth * DEFAULT_LAYOUT.levelGap, z: Math.sin(a) * radius }, cam.current, w, h);
          if (!p) continue;
          i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }

    // The hierarchy: a line from each node to its parent.
    ctx.setLineDash([]);
    for (const l of d.lines) {
      const a = at.get(l.from);
      const b = at.get(l.to);
      if (!a || !b) continue;
      const on = lit.has(l.from) && lit.has(l.to);
      ctx.beginPath();
      ctx.moveTo(a.at.x, a.at.y);
      ctx.lineTo(b.at.x, b.at.y);
      ctx.strokeStyle = on && focus ? accent : ink;
      ctx.globalAlpha = on && focus ? 0.95 : focus ? 0.05 : Math.max(0.1, Math.min(0.45, 0.45 * (DEFAULT_CAMERA.dist / b.at.depth)));
      ctx.lineWidth = on && focus ? 2 : 1;
      ctx.stroke();
    }

    // The links you made: solid for box links, dashed for [[text]] links, dotted for tags; arcs over the tree, straight in the network.
    const bow = d.network ? 0 : 0.22;
    for (const e of d.links) {
      const a = at.get(e.from);
      const b = at.get(e.to);
      if (!a || !b) continue;
      const picked = sameEdge(d.selectedEdge, e) || (hover.current.edge && sameEdge(hover.current.edge, e));
      const on = !!picked || (!!focus && lit.has(e.from) && lit.has(e.to) && (e.from === focus || e.to === focus));
      ctx.strokeStyle = on ? accent : e.kind === 'tag' ? col('var(--graphite)') : accent;
      ctx.globalAlpha = picked ? 1 : on ? 0.95 : focus ? 0.06 : e.kind === 'tag' ? 0.3 : e.kind === 'box' ? 0.6 : 0.45;
      ctx.lineWidth = d.prefs.linkWidth * (picked ? 2 : 1.2);
      ctx.setLineDash(e.kind === 'text' ? [6, 4] : e.kind === 'tag' ? [2, 4] : []);
      ctx.beginPath();
      ctx.moveTo(a.at.x, a.at.y);
      ctx.quadraticCurveTo((a.at.x + b.at.x) / 2, (a.at.y + b.at.y) / 2 - Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) * bow, b.at.x, b.at.y);
      ctx.stroke();
      if (d.prefs.arrows && e.kind !== 'tag') {
        // An arrowhead where the line meets the target, pointing along the end of the line.
        const before = along(a.at, b.at, bow, 0.9);
        const ang = Math.atan2(b.at.y - before.y, b.at.x - before.x);
        const tipX = b.at.x - Math.cos(ang) * (b.r + 1);
        const tipY = b.at.y - Math.sin(ang) * (b.r + 1);
        const s = 5 + d.prefs.linkWidth * 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - Math.cos(ang - 0.45) * s, tipY - Math.sin(ang - 0.45) * s);
        ctx.lineTo(tipX - Math.cos(ang + 0.45) * s, tipY - Math.sin(ang + 0.45) * s);
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
    }
    ctx.setLineDash([]);

    // The dots.
    const labelled: typeof items = [];
    for (const it of items) {
      const { node, at: a, r } = it;
      const dim = d.matches ? !d.matches.has(node.id) : false;
      const parent = d.parentOf.get(node.id);
      const colour =
        node.kind === 'root' ? ink
        : node.kind === 'group' ? col(colorVar(d.groupColour.get(node.id) ?? node.color ?? 'slate'))
        : node.kind === 'heading' ? col('var(--graphite)')
        : node.kind === 'tag' ? col(colorVar('plum'))
        : node.kind === 'card' ? col(colorVar('ochre'))
        : d.prefs.colorByGroup && parent && d.groupColour.has(parent) ? col(colorVar(d.groupColour.get(parent)!))
        : node.app ? col(colorVar(node.app === 'doc' ? 'ultra' : node.app === 'sheet' ? 'moss' : 'brick'))
        : accent;
      ctx.globalAlpha = dim ? 0.18 : fade(lit.has(node.id));
      ctx.beginPath();
      if (node.kind === 'group' || node.kind === 'root') ctx.rect(a.x - r, a.y - r, r * 2, r * 2);
      else if (node.kind === 'card') (ctx.roundRect ? ctx.roundRect(a.x - r, a.y - r, r * 2, r * 2, Math.min(3, r / 2)) : ctx.rect(a.x - r, a.y - r, r * 2, r * 2));
      else if (node.kind === 'tag') (ctx.moveTo(a.x, a.y - r * 1.2), ctx.lineTo(a.x + r * 1.2, a.y), ctx.lineTo(a.x, a.y + r * 1.2), ctx.lineTo(a.x - r * 1.2, a.y), ctx.closePath());
      else ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      const here = node.pageId && node.pageId === d.here && (node.kind === 'page' || node.kind === 'card');
      const ringed = node.id === hover.current.node || node.id === d.selected || here;
      const matched = !!d.matches && d.matches.has(node.id);
      if (ringed || matched) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = ink;
        ctx.stroke();
      }
      if (d.closed.has(node.id) && node.children.length) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = col('var(--sheet)');
        ctx.beginPath();
        ctx.moveTo(a.x - r * 0.5, a.y);
        ctx.lineTo(a.x + r * 0.5, a.y);
        ctx.moveTo(a.x, a.y - r * 0.5);
        ctx.lineTo(a.x, a.y + r * 0.5);
        ctx.stroke(); // a "+" on a folded branch
      }
      if (node.kind === 'root' || node.kind === 'group' || a.scale >= d.prefs.labelZoom || ringed || matched || (focus && lit.has(node.id))) labelled.push(it);
    }

    // Names: the nearest ones, so a big library does not turn into a wall of text.
    ctx.textAlign = 'center';
    for (const { node, at: a, r } of labelled.sort((x, y) => x.at.depth - y.at.depth).slice(0, 120)) {
      const size = Math.max(10, Math.min(15, 12 * a.scale));
      ctx.font = `${node.kind === 'group' || node.kind === 'root' ? 600 : 400} ${size}px system-ui, sans-serif`;
      const text = node.label.length > 28 ? node.label.slice(0, 27) + '…' : node.label;
      ctx.globalAlpha = d.matches && !d.matches.has(node.id) ? 0.25 : fade(lit.has(node.id));
      ctx.lineWidth = 3;
      ctx.strokeStyle = col('var(--sheet)');
      ctx.strokeText(text, a.x, a.y + r + size + 1);
      ctx.fillStyle = ink;
      ctx.fillText(text, a.x, a.y + r + size + 1);
    }
    ctx.globalAlpha = 1;
  }, [projectAll]);

  /* ---- the loop: runs only while something is moving (the force layout, a glide between layouts, the camera fitting, slow turning) ---- */
  const tick = useCallback(
    (now: number) => {
      const d = dataRef.current;
      const s = sim.current;
      let busy = false;
      if (d.network && s && s.sim.alpha >= ALPHA_MIN) {
        stepSim(s.sim, d.prefs.forces);
        stepSim(s.sim, d.prefs.forces);
        busy = true;
      }
      // Where each dot is now: its place in the current layout, or part of the way there while gliding from the other one.
      const m = morph.current;
      const k = m ? ease((now - m.t0) / MORPH_MS) : 1;
      if (m && k >= 1) morph.current = null;
      if (m && k < 1) busy = true;
      for (const n of d.nodes) {
        const target = d.network ? s?.byId.get(n.id) : d.treePos.get(n.id);
        if (!target) continue;
        const from = m && k < 1 ? m.from.get(n.id) : undefined;
        const x = from ? from.x + (target.x - from.x) * k : target.x;
        const y = from ? from.y + (target.y - from.y) * k : target.y;
        const z = from ? from.z + (target.z - from.z) * k : target.z;
        const cur = pos.current.get(n.id);
        if (cur) (cur.x = x), (cur.y = y), (cur.z = z);
        else pos.current.set(n.id, { x, y, z });
      }
      if (follow.current && !orbit.current && !grab.current) {
        const pts: P3[] = [];
        for (const n of d.nodes) {
          const p = pos.current.get(n.id);
          if (p) pts.push(p);
        }
        const goal = frame(pts, cam.current, d.network ? 1.9 : 3.1);
        const c = cam.current;
        const off = Math.abs(goal.dist - c.dist) + Math.hypot(goal.target.x - c.target.x, goal.target.y - c.target.y, goal.target.z - c.target.z);
        if (off > 0.5) {
          cam.current = easeCamera(c, goal, 0.14);
          busy = true;
        }
      }
      if (d.prefs.autoRotate && !orbit.current) {
        cam.current = { ...cam.current, yaw: cam.current.yaw + 0.004 };
        busy = true;
      }
      draw();
      raf.current = 0;
      if (busy) schedule();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draw],
  );
  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  }, [tick]);
  // The wheel and resize listeners are set up once, so they call `schedule` through a ref.
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0; // (React's development double-run would otherwise leave a dead id that blocks every later frame)
    },
    [],
  );

  // Build (or rebuild) the force layout when the dots or links change, starting every dot where it is now so nothing jumps.
  useEffect(() => {
    if (!network) {
      sim.current = null;
      return;
    }
    const made = createSim(
      nodes.map((n) => ({ id: n.id, r: sceneRadius(n, prefs.nodeScale) })),
      [...lines, ...links],
      pos.current,
    );
    if (pos.current.size) made.alpha = 0.6; // a layout that already has places only needs to re-settle
    else settle(made, prefs.forces, nodes.length <= 300 ? 120 : nodes.length <= 1000 ? 40 : 0); // a first layout opens mostly arranged; the rest happens in front of you
    sim.current = { sim: made, byId: new Map(made.nodes.map((n) => [n.id, n])) };
    schedule();
    // The forces and sizes are read from `prefs` on every step, so only the shape of the graph rebuilds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, nodes, lines, links]);
  useEffect(() => {
    if (sim.current) reheat(sim.current.sim, 0.5);
    schedule();
  }, [prefs.forces, prefs.nodeScale, schedule]);
  // Switching layout: glide from where every dot is to where it goes.
  const lastLayout = useRef(prefs.layout);
  useEffect(() => {
    if (lastLayout.current !== prefs.layout) {
      lastLayout.current = prefs.layout;
      morph.current = { from: new Map([...pos.current].map(([id, p]) => [id, { ...p }])), t0: performance.now() };
      follow.current = true;
      schedule();
    }
  }, [prefs.layout, schedule]);
  useEffect(() => {
    schedule();
  }, [nodes, lines, links, matches, selected, selectedEdge, prefs, schedule]);

  // The wheel listener must not be passive, or the page behind scrolls and the browser complains about preventDefault.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      follow.current = false;
      cam.current = { ...cam.current, dist: clampDist(cam.current.dist * Math.exp(e.deltaY * 0.0012)) };
      scheduleRef.current();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => scheduleRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitAll = useCallback(() => {
    follow.current = true;
    cam.current = { ...cam.current, yaw: 0.6, pitch: 0.35 };
    schedule();
  }, [schedule]);

  /* ---- pointer ---- */
  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };
  const hitNode = (e: { clientX: number; clientY: number }) => {
    const p = at(e);
    const all = projectAll(p.w, p.h);
    const id = pick(all.map((i) => ({ id: i.node.id, at: i.at, r: i.r })), p.x, p.y, 5);
    return id ? all.find((i) => i.node.id === id)! : null;
  };
  const hitEdge = (e: { clientX: number; clientY: number }): SceneEdge | null => {
    const p = at(e);
    const d = dataRef.current;
    const bow = d.network ? 0 : 0.22;
    const screen = new Map(projectAll(p.w, p.h).map((i) => [i.node.id, i.at]));
    let best: { e: SceneEdge; d: number } | null = null;
    for (const l of d.links) {
      const a = screen.get(l.from);
      const b = screen.get(l.to);
      if (!a || !b) continue;
      let prev: { x: number; y: number } = a;
      let dist = Infinity;
      for (let i = 1; i <= 10; i++) {
        const q = i === 10 ? b : along(a, b, bow, i / 10);
        dist = Math.min(dist, segmentDistance(p.x, p.y, prev.x, prev.y, q.x, q.y));
        prev = q;
      }
      if (dist <= EDGE_REACH && (!best || dist < best.d)) best = { e: l, d: dist };
    }
    return best?.e ?? null;
  };
  const toggle = (id: string) =>
    setClosed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const activate = (n: TNode) => {
    setSelected(n.id);
    onEdge(null);
    if (n.kind === 'page' || n.kind === 'card' || n.kind === 'heading') onOpen(n);
    else if (n.children.length) toggle(n.id);
  };
  const describe = (n: TNode) =>
    `${n.label}${n.kind === 'group' ? ' (group)' : n.kind === 'card' ? ' (card)' : n.kind === 'tag' ? ' (tag)' : n.kind === 'heading' ? ' (heading)' : n.app ? ` (${n.app === 'doc' ? 'document' : n.app === 'sheet' ? 'spreadsheet' : 'presentation'})` : ''}`;

  // The hook a browser check uses to find dots and lines (see CLAUDE.md).
  useEffect(() => {
    const el = canvas.current as (HTMLCanvasElement & { __screen?: () => ScreenInfo }) | null;
    if (!el) return;
    el.__screen = () => {
      const r = el.getBoundingClientRect();
      const d = dataRef.current;
      const all = projectAll(r.width, r.height);
      const byId = new Map(all.map((i) => [i.node.id, i.at]));
      return {
        layout: d.prefs.layout,
        alpha: sim.current?.sim.alpha ?? 0,
        nodes: all.map((i) => ({ id: i.node.id, label: i.node.label, kind: i.node.kind, x: r.left + i.at.x, y: r.top + i.at.y, r: i.r })),
        edges: d.links.flatMap((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return [];
          const m = along(a, b, d.network ? 0 : 0.22, 0.5);
          return [{ from: e.from, to: e.to, kind: e.kind, x: r.left + m.x, y: r.top + m.y }];
        }),
        hierarchyLines: d.lines.length,
      };
    };
  });

  const press = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    const n = !e.shiftKey && network ? hitNode(e) : null;
    if (n && sim.current) {
      // In the network a dot can be dragged: hold it where the pointer is, and the rest follow.
      grab.current = { id: n.node.id, depth: n.at.depth, moved: 0 };
      return;
    }
    orbit.current = { x: e.clientX, y: e.clientY, yaw: cam.current.yaw, pitch: cam.current.pitch, target: { ...cam.current.target }, shift: e.shiftKey, moved: 0 };
  };
  const move = (e: React.PointerEvent) => {
    const g = grab.current;
    if (g) {
      const node = sim.current?.byId.get(g.id);
      const p = at(e);
      if (node) {
        const was = { x: node.x, y: node.y, z: node.z };
        const to = unproject(p.x, p.y, g.depth, cam.current, p.w, p.h);
        g.moved = Math.max(g.moved, Math.hypot(to.x - was.x, to.y - was.y, to.z - was.z) * (FOV / g.depth));
        if (g.moved >= 4) {
          node.fx = to.x;
          node.fy = to.y;
          node.fz = to.z;
          reheat(sim.current!.sim, 0.3);
          schedule();
        }
      }
      return;
    }
    const o = orbit.current;
    if (o) {
      const dx = e.clientX - o.x;
      const dy = e.clientY - o.y;
      o.moved = Math.max(o.moved, Math.hypot(dx, dy));
      if (o.moved >= 4) follow.current = false;
      if (o.shift) {
        // Move the picture: along the screen's right and up directions.
        const k = cam.current.dist / 700;
        const cy = Math.cos(cam.current.yaw);
        const sy = Math.sin(cam.current.yaw);
        cam.current = { ...cam.current, target: { x: o.target.x - dx * cy * k, y: o.target.y + dy * k, z: o.target.z + dx * sy * k } };
      } else cam.current = { ...cam.current, yaw: o.yaw - dx * 0.008, pitch: clampPitch(o.pitch + dy * 0.008) };
      schedule();
      return;
    }
    const n = hitNode(e);
    const edge = n ? null : hitEdge(e);
    const id = n?.node.id ?? null;
    if (id !== hover.current.node || edge !== hover.current.edge) {
      hover.current = { node: id, edge };
      canvas.current!.style.cursor = n || edge ? 'pointer' : 'grab';
      const p = at(e);
      setTip(n ? { x: p.x, y: p.y, text: describe(n.node) } : edge ? { x: p.x, y: p.y, text: 'Click to see what this link joins' } : null);
      schedule();
    }
  };
  const release = (e: React.PointerEvent) => {
    const g = grab.current;
    grab.current = null;
    if (g) {
      const node = sim.current?.byId.get(g.id);
      if (node) (node.fx = null), (node.fy = null), (node.fz = null); // let go: it settles where the forces leave it
      if (g.moved < 4) {
        const n = dataRef.current.nodes.find((x) => x.id === g.id);
        if (n) activate(n);
      } else if (sim.current) reheat(sim.current.sim, 0.2);
      schedule();
      return;
    }
    const o = orbit.current;
    orbit.current = null;
    if (o && o.moved < 4) {
      const n = hitNode(e);
      if (n) return activate(n.node);
      const edge = hitEdge(e);
      onEdge(edge);
      if (!edge) setSelected(null);
      schedule();
    }
  };

  return (
    <div className="tree3d">
      <TreeList
        root={tree}
        closed={closed}
        selected={selected}
        matches={matches}
        onToggle={toggle}
        onActivate={activate}
        onFocusNode={(id) => {
          setSelected(id);
          const p = pos.current.get(id);
          if (p) {
            follow.current = false;
            cam.current = { ...cam.current, target: { ...p } };
          }
          schedule();
        }}
      />
      <div className="tree3d-stage">
        <canvas
          ref={canvas}
          className="tree3d-canvas"
          data-layout={prefs.layout}
          tabIndex={0}
          role="img"
          aria-label="Your notes as a 3D picture: drag the background to turn it, scroll to zoom, click a dot to open it. The list on the left has the same notes as a tree."
          onPointerDown={press}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={() => {
            hover.current = { node: null, edge: null };
            setTip(null);
            schedule();
          }}
          onDoubleClick={(e) => !hitNode(e) && fitAll()}
          onKeyDown={(e) => {
            const c = cam.current;
            if (e.key === 'ArrowLeft') cam.current = { ...c, yaw: c.yaw + 0.12 };
            else if (e.key === 'ArrowRight') cam.current = { ...c, yaw: c.yaw - 0.12 };
            else if (e.key === 'ArrowUp') cam.current = { ...c, pitch: clampPitch(c.pitch - 0.1) };
            else if (e.key === 'ArrowDown') cam.current = { ...c, pitch: clampPitch(c.pitch + 0.1) };
            else if (e.key === '+' || e.key === '=') cam.current = { ...c, dist: clampDist(c.dist * 0.85) };
            else if (e.key === '-') cam.current = { ...c, dist: clampDist(c.dist / 0.85) };
            else if (e.key === '0') return fitAll();
            else return;
            follow.current = false;
            e.preventDefault();
            schedule();
          }}
        />
        {tip && <div className="tree3d-tip" style={{ left: tip.x + 14, top: tip.y + 12 }}>{tip.text}</div>}
        <div className="tree3d-help" aria-hidden="true">
          Drag to turn · Scroll to zoom · Shift+drag to move · {network ? 'Drag a dot to pull it · ' : ''}Click a dot to open it, a group to fold it · Double-click to fit
        </div>
        <div className="tree3d-btns">
          <button className="btn small" onClick={fitAll}>Fit</button>
          <button className="btn small" onClick={() => setClosed(new Set())}>Open all</button>
          <button className="btn small" onClick={() => setClosed(new Set(flatten(tree).filter((n) => n.kind === 'group' || n.kind === 'root').filter((n) => n.depth > 0).map((n) => n.id)))}>Fold groups</button>
        </div>
      </div>
    </div>
  );
}
