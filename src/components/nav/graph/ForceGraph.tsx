import { useCallback, useEffect, useMemo, useRef, type PointerEvent as RPointerEvent } from 'react';
import type { Group } from '../../../types';
import { isTagNode, nodeRadius, type GEdge, type Graph, type GNode } from '../../../lib/graphModel';
import { bounds, createSim, reheat, settle, stepSim, type Sim } from '../../../lib/graphSim';
import type { GraphPrefs } from '../../../lib/graphPrefs';
import { colorVar } from '../../../lib/util';

const CLICK_SLOP = 4; // pointer travel (screen pixels) that still counts as a click, not a drag
const MIN_K = 0.08;
const MAX_K = 8;
const FIT_MAX_K = 1.6; // fitting never zooms a small graph in further than this

interface Props {
  graph: Graph;
  prefs: GraphPrefs;
  groups: Group[];
  /** The page the person came from: drawn with a ring. */
  here: string | null;
  /** Nodes that match the search; the rest are dimmed. Null = no search. */
  match: Set<string> | null;
  onOpen: (n: GNode) => void;
  onEdge: (e: GEdge) => void;
  selectedEdge: GEdge | null;
}

/**
 * The force graph, like Obsidian's: dots settle by themselves, drag one and the rest follow, scroll to zoom, drag the background to move
 * around. The picture is SVG; positions are written to it directly each frame (React only draws the dots and lines when the graph changes).
 */
export function ForceGraph({ graph, prefs, groups, here, match, onOpen, onEdge, selectedEdge }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const world = useRef<SVGGElement>(null);
  const sim = useRef<Sim | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef(new Map<string, { line: SVGLineElement; hit: SVGLineElement }>());
  const frame = useRef(0);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const hover = useRef<string | null>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; travelled: number } | null>(null);
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const fitted = useRef(false);

  const colors = useMemo(() => new Map(groups.map((g) => [g.id, g.color])), [groups]);
  const colorOf = (n: GNode) => (n.kind === 'tag' ? colorVar('plum') : n.kind === 'card' ? colorVar('ochre') : prefs.colorByGroup && n.groupId && colors.get(n.groupId) ? colorVar(colors.get(n.groupId)!) : 'var(--accent, #4a6cf7)');
  const radiusOf = useCallback((n: GNode) => nodeRadius(n.links, prefs.nodeScale), [prefs.nodeScale]);
  const edgeKey = (e: GEdge) => `${e.from}>${e.to}`;

  /* ---- drawing positions into the SVG ---- */
  const paint = useCallback(() => {
    const s = sim.current;
    if (!s) return;
    const byId = new Map(s.nodes.map((n) => [n.id, n]));
    for (const n of s.nodes) nodeEls.current.get(n.id)?.setAttribute('transform', `translate(${n.x.toFixed(2)} ${n.y.toFixed(2)})`);
    for (const [key, els] of edgeEls.current) {
      const [from, to] = key.split('>');
      const a = byId.get(from);
      const b = byId.get(to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const x2 = b.x - (dx / len) * (b.r + 2); // end at the target's edge, so the arrowhead is not under the dot
      const y2 = b.y - (dy / len) * (b.r + 2);
      for (const el of [els.line, els.hit]) {
        el.setAttribute('x1', a.x.toFixed(2));
        el.setAttribute('y1', a.y.toFixed(2));
        el.setAttribute('x2', x2.toFixed(2));
        el.setAttribute('y2', y2.toFixed(2));
      }
    }
  }, []);

  const applyView = useCallback(() => {
    const v = view.current;
    world.current?.setAttribute('transform', `translate(${v.x.toFixed(2)} ${v.y.toFixed(2)}) scale(${v.k.toFixed(4)})`);
    const el = svg.current;
    if (!el) return;
    el.style.setProperty('--inv-k', String(1 / v.k));
    el.classList.toggle('labels-off', v.k < prefsRef.current.labelZoom);
  }, []);

  const fit = useCallback(() => {
    const s = sim.current;
    const el = svg.current;
    if (!s || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const b = bounds(s.nodes);
    const w = Math.max(b.maxX - b.minX, 80);
    const h = Math.max(b.maxY - b.minY, 80);
    const k = Math.min(FIT_MAX_K, Math.max(MIN_K, Math.min((width - 80) / w, (height - 80) / h)));
    view.current = { k, x: width / 2 - ((b.minX + b.maxX) / 2) * k, y: height / 2 - ((b.minY + b.maxY) / 2) * k };
    applyView();
  }, [applyView]);

  /* ---- the animation loop: runs while the picture is still moving ---- */
  const run = useCallback(() => {
    if (frame.current) return;
    const tick = () => {
      frame.current = 0;
      const s = sim.current;
      if (!s) return;
      const moving = stepSim(s, prefsRef.current.forces);
      stepSim(s, prefsRef.current.forces); // two steps a frame: settles in about two seconds
      paint();
      if (moving || drag.current) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [paint]);

  /* ---- a new graph (filters changed, a page was added): keep old places, start from there ---- */
  useEffect(() => {
    const prev = sim.current ? new Map(sim.current.nodes.map((n) => [n.id, { x: n.x, y: n.y }])) : undefined;
    const s = createSim(graph.nodes.map((n) => ({ id: n.id, r: radiusOf(n) })), graph.edges, prev);
    sim.current = s;
    if (!prev) {
      settle(s, prefsRef.current.forces, 140); // a first picture that is already roughly settled
      s.alpha = Math.max(s.alpha, 0.08);
    } else reheat(s, 0.5);
    paint();
    if (!fitted.current && graph.nodes.length) {
      fitted.current = true;
      fit();
    }
    run();
  }, [graph, radiusOf, paint, run, fit]);

  // A force slider moved: heat up so it re-settles with the new setting. Dot size changed: sizes are part of the push.
  useEffect(() => {
    if (sim.current) {
      for (const n of sim.current.nodes) {
        const g = graph.nodes.find((x) => x.id === n.id);
        if (g) n.r = radiusOf(g);
      }
      reheat(sim.current, 0.4);
      run();
    }
  }, [prefs.forces, prefs.nodeScale, graph.nodes, radiusOf, run]);

  useEffect(() => applyView(), [prefs.labelZoom, applyView]);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0; // (React runs effects twice in development: a stale id here would stop the animation for good)
    },
    [],
  );
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(() => !fitted.current && graph.nodes.length && (fitted.current = true, fit()));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, graph.nodes.length]);

  /* ---- pointer: zoom, pan, drag a node ---- */
  const toWorld = (cx: number, cy: number) => {
    const r = svg.current!.getBoundingClientRect();
    const v = view.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = view.current;
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-e.deltaY * 0.0015)));
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      view.current = { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k }; // zoom around the pointer
      applyView();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [applyView]);

  const onBackgroundDown = (e: RPointerEvent) => {
    if ((e.target as Element).closest('.graph-node, .graph-edge-hit')) return;
    pan.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (d) {
      d.travelled = Math.max(d.travelled, Math.hypot(e.clientX - d.sx, e.clientY - d.sy));
      if (d.travelled < CLICK_SLOP) return;
      const n = sim.current?.nodes.find((x) => x.id === d.id);
      if (n) {
        const w = toWorld(e.clientX, e.clientY);
        n.fx = w.x;
        n.fy = w.y;
        reheat(sim.current!, 0.3);
        run();
      }
    } else if (pan.current) {
      view.current = { ...view.current, x: pan.current.vx + e.clientX - pan.current.x, y: pan.current.vy + e.clientY - pan.current.y };
      applyView();
    }
  };
  const endPointer = () => {
    const d = drag.current;
    if (d) {
      // The svg holds the pointer while a dot is pressed, so the browser sends the click to the svg, not the dot: open here instead.
      const target = graph.nodes.find((x) => x.id === d.id);
      const clicked = d.travelled < CLICK_SLOP && target && !isTagNode(target.id);
      const n = sim.current?.nodes.find((x) => x.id === d.id);
      if (n) (n.fx = null), (n.fy = null); // let go: it settles where the forces leave it
      drag.current = null;
      if (sim.current) reheat(sim.current, 0.2);
      run();
      if (clicked && target) onOpen(target);
    }
    pan.current = null;
  };

  /* ---- highlighting ---- */
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      (m.get(e.from) ?? m.set(e.from, new Set()).get(e.from)!).add(e.to);
      (m.get(e.to) ?? m.set(e.to, new Set()).get(e.to)!).add(e.from);
    }
    return m;
  }, [graph.edges]);
  const setHover = (id: string | null) => {
    hover.current = id;
    const el = svg.current;
    if (!el) return;
    const near = id ? neighbours.get(id) : null;
    el.classList.toggle('has-hover', !!id);
    for (const [nid, g] of nodeEls.current) g.classList.toggle('lit', !!id && (nid === id || !!near?.has(nid)));
    for (const [key, els] of edgeEls.current) {
      const [a, b] = key.split('>');
      els.line.classList.toggle('lit', !!id && (a === id || b === id));
    }
  };

  return (
    <svg
      ref={svg}
      className={`graph-svg force${match ? ' searching' : ''}${prefs.arrows ? '' : ' no-arrows'}`}
      role="img"
      aria-label="Pages, cards and the links between them"
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={(e) => !(e.target as Element).closest('.graph-node') && fit()}
    >
      <defs>
        <marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="currentColor" fillOpacity="0.55" />
        </marker>
      </defs>
      <g ref={world}>
        {graph.edges.map((e) => {
          const key = edgeKey(e);
          const picked = selectedEdge && edgeKey(selectedEdge) === key;
          return (
            <g key={key} className={`graph-edge-g${picked ? ' picked' : ''}`}>
              <line
                ref={(el) => void (el ? edgeEls.current.set(key, { line: el, hit: edgeEls.current.get(key)?.hit ?? el }) : edgeEls.current.delete(key))}
                className={`graph-edge ${e.kind}`}
                strokeWidth={prefs.linkWidth}
                markerEnd={prefs.arrows && e.kind !== 'tag' ? 'url(#graph-arrow)' : undefined}
              />
              <line
                ref={(el) => {
                  const cur = edgeEls.current.get(key);
                  if (el && cur) edgeEls.current.set(key, { line: cur.line, hit: el });
                }}
                className="graph-edge-hit"
                role="button"
                tabIndex={0}
                aria-label={`Link from ${graph.nodes.find((n) => n.id === e.from)?.title ?? ''} to ${graph.nodes.find((n) => n.id === e.to)?.title ?? ''}`}
                onClick={() => onEdge(e)}
                onKeyDown={(k) => k.key === 'Enter' && onEdge(e)}
              />
            </g>
          );
        })}
        {graph.nodes.map((n) => {
          const r = radiusOf(n);
          const dimmed = match ? !match.has(n.id) : false;
          return (
            <g
              key={n.id}
              ref={(el) => void (el ? nodeEls.current.set(n.id, el) : nodeEls.current.delete(n.id))}
              className={`graph-node ${n.kind}${dimmed ? ' off' : ''}${match?.has(n.id) ? ' hit' : ''}${n.id === here ? ' here' : ''}`}
              tabIndex={0}
              role="link"
              aria-label={`${n.kind === 'tag' ? 'Tag' : n.kind === 'card' ? 'Card' : 'Page'}: ${n.title}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, travelled: 0 };
                (svg.current as Element).setPointerCapture(e.pointerId);
              }}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n.id)}
              onBlur={() => setHover(null)}
              onKeyDown={(e) => e.key === 'Enter' && !isTagNode(n.id) && onOpen(n)}
            >
              {n.kind === 'card' ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} fill={colorOf(n)} /> : <circle r={r} fill={colorOf(n)} />}
              <text y={r + 13} textAnchor="middle">{n.title.length > 26 ? n.title.slice(0, 25) + '…' : n.title}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export { CLICK_SLOP };
