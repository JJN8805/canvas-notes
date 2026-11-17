import { useEffect, useMemo, useRef, useState } from 'react';
import { closeNav } from '../../store/nav';
import { useNotes } from '../../store/notes';
import { useGraphPrefs, setGraphPrefs } from '../../store/graphPrefs';
import { buildGraph, matchIds, type GEdge, type GNode } from '../../lib/graphModel';
import { boxLabel } from '../../lib/boxLinks';
import { currentRoute, navigate } from '../../lib/route';
import { openCard } from '../../store/cardView';
import { followLink } from '../../store/boxLinks';
import { ForceGraph } from './graph/ForceGraph';
import { GraphSettings } from './graph/GraphSettings';
import { Tree3D } from './graph/Tree3D';

/**
 * The graph view, in the spirit of Obsidian's: the **Graph** tab is a live force layout of pages, cards and tags (drag dots, zoom, filter,
 * colour by group, a local graph around the page you came from); the **3D hierarchy** tab shows the library as a tree you can turn around.
 */
export function GraphView() {
  const pages = useNotes((s) => s.pages);
  const groups = useNotes((s) => s.groups);
  const prefs = useGraphPrefs();
  const here = useMemo(() => {
    const r = currentRoute();
    return r.name === 'page' ? r.id : null;
  }, []);
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState('');
  const [tag, setTag] = useState('');
  const [depth, setDepth] = useState<0 | 1 | 2 | 3>(0);
  const [edge, setEdge] = useState<GEdge | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const tags = useMemo(() => [...new Set(Object.values(pages).flatMap((p) => p.tags))].sort(), [pages]);
  const graph = useMemo(
    () => buildGraph(pages, groups, { cards: prefs.cards, boxes: prefs.boxes, text: prefs.text, tags: prefs.tags, orphans: prefs.orphans, groupId: groupId || null, tag: tag || null, here, depth }),
    [pages, groups, prefs.cards, prefs.boxes, prefs.text, prefs.tags, prefs.orphans, groupId, tag, here, depth],
  );
  const match = useMemo(() => matchIds(graph, query), [graph, query]);

  useEffect(() => {
    search.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeNav();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const open = (n: GNode) => {
    closeNav();
    if (n.kind === 'card') openCard(n.id);
    else navigate({ name: 'page', id: n.id });
  };
  const openPage = (pageId: string, blockId?: string) => {
    closeNav();
    void followLink({ page: pageId, block: blockId });
  };
  const title = (id: string) => graph.nodes.find((n) => n.id === id)?.title ?? 'Missing';
  const sources = (e: GEdge) =>
    (e.via ?? []).map((v) => {
      const from = pages[e.from]?.blocks.find((b) => b.id === v.fromBlock);
      const to = v.toBlock ? pages[e.to]?.blocks.find((b) => b.id === v.toBlock) : null;
      return { fromLabel: from ? boxLabel(from) : 'a box', toLabel: to ? boxLabel(to) : 'the whole page', v };
    });
  const tree = prefs.tab === 'tree';

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeNav()}>
      <div className="dialog graphview" role="dialog" aria-label="Graph view">
        <header className="graph-head">
          <div className="graph-tabs" role="tablist" aria-label="Kind of graph">
            <button role="tab" aria-selected={!tree} className={!tree ? 'on' : ''} onClick={() => setGraphPrefs({ tab: 'graph' })}>Graph</button>
            <button role="tab" aria-selected={tree} className={tree ? 'on' : ''} onClick={() => setGraphPrefs({ tab: 'tree' })}>3D hierarchy</button>
          </div>
          <div className="graph-tools">
            <input ref={search} className="field" type="search" placeholder={tree ? 'Find a page or group' : 'Find a page, card or tag'} aria-label="Find in the graph" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="btn small" aria-pressed={prefs.panelOpen} onClick={() => setGraphPrefs({ panelOpen: !prefs.panelOpen })}>{prefs.panelOpen ? 'Hide settings' : 'Settings'}</button>
          <button className="btn small" onClick={closeNav}>Close</button>
        </header>
        <div className={`graph-body${prefs.panelOpen ? '' : ' no-panel'}`}>
          {prefs.panelOpen && <GraphSettings prefs={prefs} groups={groups} tags={tags} groupId={groupId} setGroupId={setGroupId} tag={tag} setTag={setTag} hasHere={!!here} depth={depth} setDepth={setDepth} />}
          <div className="graph-main">
            {tree ? (
              <Tree3D pages={pages} groups={groups} prefs={prefs} here={here} query={query} onOpen={openPage} />
            ) : (
              <>
                {graph.nodes.length === 0 ? (
                  <p className="graph-empty">Nothing to show with these filters.</p>
                ) : graph.edges.length === 0 ? (
                  <p className="graph-empty">No links yet. Use a box’s link button (or right-click → Links…), or type <code>[[Page title]]</code> in a note. Tags can be shown as dots too.</p>
                ) : null}
                <ForceGraph graph={graph} prefs={prefs} groups={groups} here={here} match={match} onOpen={open} onEdge={setEdge} selectedEdge={edge} />
                {edge && (
                  <div className="graph-edge-info" role="status">
                    <strong>{title(edge.from)}</strong> → <strong>{title(edge.to)}</strong>
                    {edge.kind === 'text' && !edge.via?.length && <span> — written as [[{title(edge.to)}]] in text</span>}
                    {edge.kind === 'tag' && <span> — uses this tag</span>}
                    <ul>
                      {sources(edge).map((s, i) => (
                        <li key={i}>
                          <button className="btn small" onClick={() => openPage(edge.from, s.v.fromBlock ?? undefined)}>{s.fromLabel}</button>
                          {' → '}
                          <button className="btn small" onClick={() => openPage(edge.to, s.v.toBlock ?? undefined)}>{s.toLabel}</button>
                        </li>
                      ))}
                    </ul>
                    <button className="btn small" onClick={() => setEdge(null)}>Close</button>
                  </div>
                )}
                <p className="graph-key">{graph.nodes.length} dots · drag a dot, scroll to zoom, drag the background to move, double-click it to fit · ● page ■ card · solid line = box link, dashed = [[text]] link</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
