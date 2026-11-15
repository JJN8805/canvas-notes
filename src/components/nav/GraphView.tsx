import { useEffect, useMemo, useRef, useState } from 'react';
import { closeNav } from '../../store/nav';
import { useNotes } from '../../store/notes';
import { filterGraph, layoutGraph, linkGraph, neighbourhood, type GraphEdge, type GraphNode } from '../../lib/links';
import { boxLabel } from '../../lib/boxLinks';
import { currentRoute, navigate } from '../../lib/route';
import { openCard } from '../../store/cardView';
import { followLink } from '../../store/boxLinks';
import { groupTree } from '../../lib/groups';

const W = 900;
const H = 600;
const CLICK_SLOP = 4; // pointer travel (in screen pixels) that still counts as a click rather than a drag

/**
 * Every page (and, if switched on, every card) as a dot and every link as a line with an arrowhead: solid for links you made on a box,
 * frame or card, dashed for [[Page title]] written in text. Bigger dots have more links. Hover a dot to light up what it touches,
 * click to open it, drag to move it. Click a line to see which boxes it joins. Filter by group or tag, or show only what is
 * "around this page" (1 or 2 links away).
 */
export function GraphView() {
  const pages = useNotes((s) => s.pages);
  const groups = useNotes((s) => s.groups);
  const here = useMemo(() => {
    const r = currentRoute();
    return r.name === 'page' ? r.id : null;
  }, []);
  const [cards, setCards] = useState(true);
  const [boxes, setBoxes] = useState(true);
  const [text, setText] = useState(true);
  const [depth, setDepth] = useState<0 | 1 | 2>(0); // 0 = everything
  const [groupId, setGroupId] = useState('');
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [edge, setEdge] = useState<GraphEdge | null>(null);
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; travelled: number } | null>(null);
  const lastTravel = useRef(0); // how far the last press travelled, still known when the click that follows the release arrives

  const tags = useMemo(() => [...new Set(Object.values(pages).flatMap((p) => p.tags))].sort(), [pages]);
  const groupRows = useMemo(() => groupTree(groups), [groups]);

  const { graph, base } = useMemo(() => {
    const full = linkGraph(pages, { cards, boxes, text });
    const filtered = filterGraph(full, pages, groups, { groupId: groupId || null, tag: tag || null });
    const g = depth && here ? neighbourhood(filtered, here, depth) : filtered;
    return { graph: g, base: layoutGraph(g, W, H) };
  }, [pages, groups, cards, boxes, text, depth, here, groupId, tag]);
  // Dots the person moved stay where they put them, for as long as the graph is open.
  const pos = useMemo(() => new Map([...base].map(([id, p]) => [id, moved[id] ?? p])), [base, moved]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeNav();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const q = query.trim().toLowerCase();
  const touching = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const e of graph.edges) {
      if (e.from === hover) s.add(e.to);
      if (e.to === hover) s.add(e.from);
    }
    return s;
  }, [hover, graph]);
  const radius = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.links])), [graph]);
  const title = (id: string) => graph.nodes.find((n) => n.id === id)?.title ?? 'Missing';

  function open(n: GraphNode) {
    closeNav();
    if (n.kind === 'card') openCard(n.id);
    else navigate({ name: 'page', id: n.id });
  }
  const dim = (id: string, t: string) => (touching ? !touching.has(id) : q ? !t.toLowerCase().includes(q) : false);

  /** Screen position of the pointer in the picture's own coordinates. */
  const toSvg = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(m.inverse());
    return { x: Math.min(W - 12, Math.max(12, p.x)), y: Math.min(H - 12, Math.max(12, p.y)) };
  };

  const edgeSources = (e: GraphEdge) =>
    (e.via ?? []).map((v) => {
      const from = pages[e.from]?.blocks.find((b) => b.id === v.fromBlock);
      const to = v.toBlock ? pages[e.to]?.blocks.find((b) => b.id === v.toBlock) : null;
      return { fromLabel: from ? boxLabel(from) : 'a box', toLabel: to ? boxLabel(to) : 'the whole page', v };
    });

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeNav()}>
      <div className="dialog graphview" role="dialog" aria-label="Graph view">
        <h2>Graph view</h2>
        <div className="graph-tools">
          <input className="field" type="search" placeholder="Find a page or card" aria-label="Find in the graph" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label><input type="checkbox" checked={cards} onChange={(e) => setCards(e.target.checked)} /> Cards</label>
          <label><input type="checkbox" checked={boxes} onChange={(e) => setBoxes(e.target.checked)} /> Box links</label>
          <label><input type="checkbox" checked={text} onChange={(e) => setText(e.target.checked)} /> [[Text]] links</label>
          <select className="field" aria-label="Only this group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">All groups</option>
            {groupRows.map((r) => (
              <option key={r.group.id} value={r.group.id}>{'  '.repeat(r.depth)}{r.group.name}</option>
            ))}
          </select>
          <select className="field" aria-label="Only this tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
          </select>
          {here && (
            <select className="field" aria-label="How much to show" value={depth} onChange={(e) => setDepth(Number(e.target.value) as 0 | 1 | 2)}>
              <option value={0}>Everything</option>
              <option value={1}>Around this page (1 link)</option>
              <option value={2}>Around this page (2 links)</option>
            </select>
          )}
        </div>
        {graph.nodes.length === 0 ? (
          <p>Nothing to show.</p>
        ) : graph.edges.length === 0 ? (
          <p>No links yet. Use a box’s link button (or right-click → Links…), or type <code>[[Page title]]</code> in a text box.</p>
        ) : null}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="graph-svg"
          role="img"
          aria-label="Pages, cards and the links between them"
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            d.travelled = Math.max(d.travelled, Math.hypot(e.clientX - d.sx, e.clientY - d.sy));
            if (d.travelled < CLICK_SLOP) return;
            const p = toSvg(e);
            if (p) setMoved((m) => ({ ...m, [d.id]: p }));
          }}
          onPointerUp={() => {
            lastTravel.current = drag.current?.travelled ?? lastTravel.current;
            drag.current = null;
          }}
          onPointerLeave={() => {
            lastTravel.current = drag.current?.travelled ?? lastTravel.current;
            drag.current = null;
          }}
        >
          <defs>
            <marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="currentColor" fillOpacity="0.5" />
            </marker>
          </defs>
          {graph.edges.map((e) => {
            const a = pos.get(e.from)!;
            const b = pos.get(e.to)!;
            const off = !!touching && !(e.from === hover || e.to === hover);
            // End the line at the edge of the target's dot, so the arrowhead is not hidden under it.
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const rb = 6 + Math.min(radius.get(e.to) ?? 0, 8);
            const x2 = b.x - ((b.x - a.x) / len) * rb;
            const y2 = b.y - ((b.y - a.y) / len) * rb;
            const picked = edge && edge.from === e.from && edge.to === e.to;
            return (
              <g key={e.from + e.to} className={`graph-edge-g${picked ? ' picked' : ''}`}>
                <line x1={a.x} y1={a.y} x2={x2} y2={y2} markerEnd="url(#graph-arrow)" className={`graph-edge ${e.kind}${off ? ' off' : ''}`} />
                {/* a wider invisible line to click */}
                <line x1={a.x} y1={a.y} x2={x2} y2={y2} className="graph-edge-hit" role="button" tabIndex={0}
                  aria-label={`Link from ${title(e.from)} to ${title(e.to)}`}
                  onClick={() => setEdge(e)} onKeyDown={(k) => k.key === 'Enter' && setEdge(e)} />
              </g>
            );
          })}
          {graph.nodes.map((n) => {
            const p = pos.get(n.id)!;
            const r = 5 + Math.min(n.links, 8);
            return (
              <g
                key={n.id}
                className={`graph-node ${n.kind}${dim(n.id, n.title) ? ' off' : ''}${n.id === here ? ' here' : ''}`}
                tabIndex={0}
                role="link"
                aria-label={`${n.kind === 'card' ? 'Card' : 'Page'}: ${n.title}`}
                onPointerDown={(e) => {
                  lastTravel.current = 0;
                  drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, travelled: 0 };
                }}
                onClick={() => {
                  // A drag that moved the dot is not a click on it.
                  if (lastTravel.current < CLICK_SLOP) open(n);
                }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(n.id)}
                onBlur={() => setHover(null)}
                onKeyDown={(e) => e.key === 'Enter' && open(n)}
              >
                {n.kind === 'card' ? <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={3} /> : <circle cx={p.x} cy={p.y} r={r} />}
                <text x={p.x} y={p.y + r + 14} textAnchor="middle">
                  {n.title.length > 22 ? n.title.slice(0, 21) + '…' : n.title}
                </text>
              </g>
            );
          })}
        </svg>
        {edge && (
          <div className="graph-edge-info" role="status">
            <strong>{title(edge.from)}</strong> → <strong>{title(edge.to)}</strong>
            {edge.kind === 'text' && !edge.via?.length && <span> — written as [[{title(edge.to)}]] in text</span>}
            <ul>
              {edgeSources(edge).map((s, i) => (
                <li key={i}>
                  <button className="btn small" onClick={() => { closeNav(); void followLink({ page: edge.from, block: s.v.fromBlock ?? undefined }); }}>{s.fromLabel}</button>
                  {' → '}
                  <button className="btn small" onClick={() => { closeNav(); void followLink({ page: edge.to, block: s.v.toBlock ?? undefined }); }}>{s.toLabel}</button>
                </li>
              ))}
            </ul>
            <button className="btn small" onClick={() => setEdge(null)}>Close</button>
          </div>
        )}
        <p className="graph-key">● page &nbsp; ■ card &nbsp; solid line = box link &nbsp; dashed = [[text]] link &nbsp; drag a dot to move it, click a line for details</p>
        <div className="dialog-actions">
          <button className="btn" onClick={closeNav}>Close</button>
        </div>
      </div>
    </div>
  );
}
