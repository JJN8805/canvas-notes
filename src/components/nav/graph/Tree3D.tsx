import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Group, Page } from '../../../types';
import { linkGraph } from '../../../lib/links';
import type { GraphPrefs } from '../../../lib/graphPrefs';
import {
  DEFAULT_CAMERA, DEFAULT_LAYOUT, buildTree, clampDist, clampPitch, coneLayout, flatten, frame, pick, project, visible,
  type Camera, type P3, type Projected, type TNode,
} from '../../../lib/tree3d';
import { colorVar } from '../../../lib/util';
import { TreeList } from './TreeList';

const RADIUS: Record<TNode['kind'], number> = { root: 11, group: 9, page: 6.5, heading: 3.5 };

/** `var(--c-teal)` as the colour the canvas needs (a canvas cannot read CSS variables itself). */
function resolve(el: Element, v: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? getComputedStyle(el).getPropertyValue(m[1]).trim() || '#888' : v;
}

interface Props {
  pages: Record<string, Page>;
  groups: Group[];
  prefs: GraphPrefs;
  here: string | null;
  query: string;
  onOpen: (pageId: string, blockId?: string) => void;
}

/** The library as a tree you can turn around: drag to turn, scroll to zoom, Shift+drag to move, click a page to open it, click a group to fold it. */
export function Tree3D({ pages, groups, prefs, here, query, onOpen }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ ...DEFAULT_CAMERA });
  const raf = useRef(0);
  const hover = useRef<string | null>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; target: P3; shift: boolean; moved: number } | null>(null);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const tree = useMemo(() => buildTree(pages, groups, { headings: prefs.headings }), [pages, groups, prefs.headings]);
  const nodes = useMemo(() => visible(tree, closed), [tree, closed]);
  const positions = useMemo(() => coneLayout(tree, closed, DEFAULT_LAYOUT), [tree, closed]);
  const parentOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of flatten(tree)) for (const c of n.children) m.set(c.id, n.id);
    return m;
  }, [tree]);
  const links = useMemo(() => (prefs.links3d ? linkGraph(pages, { cards: false, boxes: prefs.boxes, text: prefs.text }).edges : []), [pages, prefs.links3d, prefs.boxes, prefs.text]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q ? new Set(nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id)) : null), [nodes, q]);
  const dataRef = useRef({ nodes, positions, links, matches, selected, parentOf, here, prefs });
  dataRef.current = { nodes, positions, links, matches, selected, parentOf, here, prefs };

  /** Everything on screen, with where it is: used both to draw and to find what the pointer is over. */
  const projectAll = useCallback((w: number, h: number) => {
    const { nodes: ns, positions: pos } = dataRef.current;
    const out: { node: TNode; at: Projected; r: number }[] = [];
    for (const node of ns) {
      const p = pos.get(node.id);
      const at = p && project(p, cam.current, w, h);
      if (at) out.push({ node, at, r: Math.max(2, RADIUS[node.kind] * at.scale * 1.15) });
    }
    return out;
  }, []);

  const draw = useCallback(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
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
    const ink = resolve(el, 'var(--ink)');
    const rule = resolve(el, 'var(--rule)');
    const accent = resolve(el, 'var(--accent)');
    const items = projectAll(w, h).sort((a, b) => b.at.depth - a.at.depth); // far first, so near things paint over them
    const at = new Map(items.map((i) => [i.node.id, i]));

    // A faint ring for each level, so the layers can be told apart.
    const levelR = new Map<number, number>();
    for (const n of d.nodes) {
      const p = d.positions.get(n.id);
      if (p) levelR.set(n.depth, Math.max(levelR.get(n.depth) ?? 0, Math.hypot(p.x, p.z)));
    }
    ctx.lineWidth = 1;
    for (const [depth, radius] of levelR) {
      if (!radius) continue;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const p = project({ x: Math.cos(a) * radius, y: -depth * DEFAULT_LAYOUT.levelGap, z: Math.sin(a) * radius }, cam.current, w, h);
        if (!p) continue;
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = rule;
      ctx.globalAlpha = 0.45;
      ctx.stroke();
    }

    // The branch under the pointer (and the way up to the library) is drawn stronger.
    const lit = new Set<string>();
    for (let id: string | undefined = hover.current ?? d.selected ?? undefined; id; id = d.parentOf.get(id)) lit.add(id);
    // Branches.
    ctx.globalAlpha = 1;
    for (const { node, at: a } of items) {
      const parent = d.parentOf.get(node.id);
      const pa = parent ? at.get(parent) : null;
      if (!pa) continue;
      const on = lit.has(node.id) && lit.has(parent!);
      ctx.beginPath();
      ctx.moveTo(pa.at.x, pa.at.y);
      ctx.lineTo(a.x, a.y);
      ctx.strokeStyle = on ? accent : ink;
      ctx.globalAlpha = on ? 0.95 : Math.max(0.12, Math.min(0.5, 0.5 * (DEFAULT_CAMERA.dist / a.depth)));
      ctx.lineWidth = on ? 2 : 1;
      ctx.stroke();
    }
    // Links between pages (the ones you wrote or made), as arcs over the tree.
    if (d.prefs.links3d) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.45;
      for (const e of d.links) {
        const a = at.get(`p:${e.from}`);
        const b = at.get(`p:${e.to}`);
        if (!a || !b) continue;
        const mx = (a.at.x + b.at.x) / 2;
        const my = (a.at.y + b.at.y) / 2 - Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) * 0.25;
        ctx.beginPath();
        ctx.moveTo(a.at.x, a.at.y);
        ctx.quadraticCurveTo(mx, my, b.at.x, b.at.y);
        ctx.stroke();
      }
    }
    // Nodes.
    ctx.globalAlpha = 1;
    const labelled: typeof items = [];
    for (const it of items) {
      const { node, at: a, r } = it;
      const dim = d.matches ? !d.matches.has(node.id) : false;
      const colour =
        node.kind === 'root' ? ink
        : node.kind === 'group' ? resolve(el, colorVar(groups.find((g) => `g:${g.id}` === node.id)?.color ?? 'slate'))
        : node.kind === 'heading' ? resolve(el, 'var(--graphite)')
        : node.app ? resolve(el, colorVar(node.app === 'doc' ? 'ultra' : node.app === 'sheet' ? 'moss' : 'brick'))
        : accent;
      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.beginPath();
      if (node.kind === 'group' || node.kind === 'root') ctx.rect(a.x - r, a.y - r, r * 2, r * 2);
      else ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      const ringed = node.id === hover.current || node.id === d.selected || (node.pageId && node.pageId === d.here && node.kind === 'page');
      if (ringed || (d.matches && d.matches.has(node.id))) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = ink;
        ctx.stroke();
      }
      if (closed.has(node.id) && node.children.length) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = resolve(el, 'var(--sheet)');
        ctx.beginPath();
        ctx.moveTo(a.x - r * 0.5, a.y);
        ctx.lineTo(a.x + r * 0.5, a.y);
        ctx.moveTo(a.x, a.y - r * 0.5);
        ctx.lineTo(a.x, a.y + r * 0.5);
        ctx.stroke(); // a "+" on a folded branch
      }
      if (node.kind === 'root' || node.kind === 'group' || a.scale > 0.85 || ringed || (d.matches && d.matches.has(node.id))) labelled.push(it);
    }
    // Names: the nearest ones, so a big library does not turn into a wall of text.
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    for (const { node, at: a, r } of labelled.sort((x, y) => x.at.depth - y.at.depth).slice(0, 90)) {
      const size = Math.max(10, Math.min(15, 12 * a.scale));
      ctx.font = `${node.kind === 'group' || node.kind === 'root' ? 600 : 400} ${size}px system-ui, sans-serif`;
      const text = node.label.length > 28 ? node.label.slice(0, 27) + '…' : node.label;
      ctx.lineWidth = 3;
      ctx.strokeStyle = resolve(el, 'var(--sheet)');
      ctx.strokeText(text, a.x, a.y + r + size + 1);
      ctx.fillStyle = ink;
      ctx.fillText(text, a.x, a.y + r + size + 1);
    }
    ctx.globalAlpha = 1;
  }, [groups, closed, projectAll]);

  /* ---- animation: a frame when something changed, and every frame while it turns by itself ---- */
  const again = useRef(false);
  const schedule = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (dataRef.current.prefs.autoRotate && !drag.current) cam.current = { ...cam.current, yaw: cam.current.yaw + 0.004 };
      draw();
      if (dataRef.current.prefs.autoRotate) schedule();
      else if (again.current) {
        again.current = false;
        schedule();
      }
    });
  }, [draw]);
  useEffect(() => {
    schedule();
  }, [nodes, positions, links, matches, selected, prefs, schedule]);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0; // (React's development double-run would otherwise leave a dead id that blocks every later frame)
    },
    [],
  );
  // The wheel listener must not be passive, or the page behind scrolls and the browser complains about preventDefault.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.current = { ...cam.current, dist: clampDist(cam.current.dist * Math.exp(e.deltaY * 0.0012)) };
      schedule();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [schedule]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => schedule());
    ro.observe(el);
    return () => ro.disconnect();
  }, [schedule]);

  // The whole tree in view when it first appears, and when the Fit button asks.
  const fitAll = useCallback(() => {
    cam.current = frame(dataRef.current.positions.values(), { ...cam.current, yaw: 0.6, pitch: 0.35 });
    schedule();
  }, [schedule]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current && nodes.length > 1) {
      first.current = false;
      fitAll();
    }
  }, [nodes.length, fitAll]);

  /* ---- pointer ---- */
  const rect = () => canvas.current!.getBoundingClientRect();
  const at = (e: { clientX: number; clientY: number }) => {
    const r = rect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };
  const hit = (e: { clientX: number; clientY: number }): TNode | null => {
    const p = at(e);
    const all = projectAll(p.w, p.h);
    const id = pick(all.map((i) => ({ id: i.node.id, at: i.at, r: i.r })), p.x, p.y, 5);
    return id ? all.find((i) => i.node.id === id)!.node : null;
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
    if (n.kind === 'page' && n.pageId) onOpen(n.pageId);
    else if (n.kind === 'heading' && n.pageId) onOpen(n.pageId, n.blockId);
    else if (n.children.length) toggle(n.id);
  };

  return (
    <div className="tree3d">
      <TreeList root={tree} closed={closed} selected={selected} matches={matches} onToggle={toggle} onActivate={activate} onFocusNode={(id) => {
        setSelected(id);
        const p = dataRef.current.positions.get(id);
        if (p) cam.current = { ...cam.current, target: { ...p } };
        schedule();
      }} />
      <div className="tree3d-stage">
        <canvas
          ref={canvas}
          className="tree3d-canvas"
          tabIndex={0}
          role="img"
          aria-label="Your library as a 3D tree: drag to turn it, scroll to zoom, click a page to open it. The list on the left has the same tree."
          onPointerDown={(e) => {
            canvas.current!.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, yaw: cam.current.yaw, pitch: cam.current.pitch, target: { ...cam.current.target }, shift: e.shiftKey, moved: 0 };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) {
              const dx = e.clientX - d.x;
              const dy = e.clientY - d.y;
              d.moved = Math.max(d.moved, Math.hypot(dx, dy));
              if (d.shift) {
                // Move the picture: along the screen's right and up directions.
                const k = cam.current.dist / 700;
                const cy = Math.cos(cam.current.yaw);
                const sy = Math.sin(cam.current.yaw);
                cam.current = { ...cam.current, target: { x: d.target.x - (dx * cy) * k, y: d.target.y + dy * k, z: d.target.z + (dx * sy) * k } };
              } else cam.current = { ...cam.current, yaw: d.yaw - dx * 0.008, pitch: clampPitch(d.pitch + dy * 0.008) };
              schedule();
              return;
            }
            const n = hit(e);
            const id = n?.id ?? null;
            if (id !== hover.current) {
              hover.current = id;
              canvas.current!.style.cursor = n ? 'pointer' : 'grab';
              const p = at(e);
              setTip(n ? { x: p.x, y: p.y, text: `${n.label}${n.kind === 'group' ? ' (group)' : n.kind === 'root' ? '' : n.kind === 'heading' ? ' (heading)' : n.app ? ` (${n.app === 'doc' ? 'document' : n.app === 'sheet' ? 'spreadsheet' : 'presentation'})` : ''}` } : null);
              schedule();
            }
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (d && d.moved < 4) {
              const n = hit(e);
              if (n) activate(n);
            }
          }}
          onPointerLeave={() => {
            hover.current = null;
            setTip(null);
            schedule();
          }}
          onDoubleClick={(e) => !hit(e) && fitAll()}
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
            e.preventDefault();
            schedule();
          }}
        />
        {tip && <div className="tree3d-tip" style={{ left: tip.x + 14, top: tip.y + 12 }}>{tip.text}</div>}
        <div className="tree3d-help" aria-hidden="true">Drag to turn · Scroll to zoom · Shift+drag to move · Click a page to open it, a group to fold it · Double-click to fit</div>
        <div className="tree3d-btns">
          <button className="btn small" onClick={fitAll}>Fit</button>
          <button className="btn small" onClick={() => setClosed(new Set())}>Open all</button>
          <button className="btn small" onClick={() => setClosed(new Set(flatten(tree).filter((n) => n.kind === 'group' || n.kind === 'root').filter((n) => n.depth > 0).map((n) => n.id)))}>Fold groups</button>
        </div>
      </div>
    </div>
  );
}
