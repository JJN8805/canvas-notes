import { useEffect, useMemo } from 'react';
import { closeNav } from '../../store/nav';
import { useNotes } from '../../store/notes';
import { layoutGraph, linkGraph } from '../../lib/links';
import { navigate } from '../../lib/route';

const W = 760;
const H = 520;

/** Every page as a dot and every [[link]] as a line. Bigger dots have more links. Click a dot to open that page. */
export function GraphView() {
  const pages = useNotes((s) => s.pages);
  const { graph, pos } = useMemo(() => {
    const g = linkGraph(pages);
    return { graph: g, pos: layoutGraph(g, W, H) };
  }, [pages]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeNav();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeNav()}>
      <div className="dialog graphview" role="dialog" aria-label="Graph view">
        <h2>Graph view</h2>
        {graph.nodes.length === 0 ? (
          <p>No pages yet.</p>
        ) : graph.edges.length === 0 ? (
          <p>No links yet. Type <code>[[Page title]]</code> in a text box to link two pages.</p>
        ) : null}
        <svg viewBox={`0 0 ${W} ${H}`} className="graph-svg" role="img" aria-label="Pages and the links between them">
          {graph.edges.map((e) => {
            const a = pos.get(e.from)!;
            const b = pos.get(e.to)!;
            return <line key={e.from + e.to} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="graph-edge" />;
          })}
          {graph.nodes.map((n) => {
            const p = pos.get(n.id)!;
            return (
              <g
                key={n.id}
                className="graph-node"
                tabIndex={0}
                role="link"
                aria-label={n.title}
                onClick={() => {
                  closeNav();
                  navigate({ name: 'page', id: n.id });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    closeNav();
                    navigate({ name: 'page', id: n.id });
                  }
                }}
              >
                <circle cx={p.x} cy={p.y} r={5 + Math.min(n.links, 8)} />
                <text x={p.x} y={p.y + 20 + Math.min(n.links, 8)} textAnchor="middle">
                  {n.title.length > 22 ? n.title.slice(0, 21) + '…' : n.title}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="dialog-actions">
          <button className="btn" onClick={closeNav}>Close</button>
        </div>
      </div>
    </div>
  );
}
