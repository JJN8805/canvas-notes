import { useEffect, useMemo, useRef, useState } from 'react';
import { closeNav } from '../../store/nav';
import { useNotes } from '../../store/notes';
import { useGraphPrefs, setGraphPrefs } from '../../store/graphPrefs';
import { boxLabel } from '../../lib/boxLinks';
import { buildScene, type SceneEdge } from '../../lib/scene3d';
import { flatten, type TNode } from '../../lib/tree3d';
import { currentRoute, navigate } from '../../lib/route';
import { openCard } from '../../store/cardView';
import { followLink } from '../../store/boxLinks';
import { GraphSettings } from './graph/GraphSettings';
import { Scene3D } from './graph/Scene3D';

/** A scene id (`p:abc`, `c:abc`, `tag:x`) as the page, card or tag name links use. */
const rawId = (id: string) => (id.startsWith('p:') || id.startsWith('c:') ? id.slice(2) : id);

/**
 * The graph view, in the spirit of Obsidian's but in 3D and with the hierarchy built in: one picture of pages, cards, tags, groups and
 * headings. **Network** lays them out with live forces (drag a dot, tune the forces); **Hierarchy** stacks them as library → groups → pages
 * → headings. Both share the filters, search, colours, links and the list of notes beside the picture.
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
  const [edge, setEdge] = useState<SceneEdge | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const tags = useMemo(() => [...new Set(Object.values(pages).flatMap((p) => p.tags))].sort(), [pages]);
  const scene = useMemo(
    () => buildScene(pages, groups, { cards: prefs.cards, boxes: prefs.boxes, text: prefs.text, tags: prefs.tags, orphans: prefs.orphans, headings: prefs.headings, groupId: groupId || null, tag: tag || null, here, depth }),
    [pages, groups, prefs.cards, prefs.boxes, prefs.text, prefs.tags, prefs.orphans, prefs.headings, groupId, tag, here, depth],
  );
  const labels = useMemo(() => new Map(flatten(scene.tree).map((n) => [n.id, n.label])), [scene]);
  const count = useMemo(() => flatten(scene.tree).filter((n) => n.kind === 'page' || n.kind === 'card' || n.kind === 'tag').length, [scene]);

  useEffect(() => {
    search.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeNav();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const open = (n: TNode) => {
    closeNav();
    if (n.kind === 'card' && n.pageId) openCard(n.pageId);
    else if (n.kind === 'page' && n.pageId) navigate({ name: 'page', id: n.pageId });
    else if (n.kind === 'heading' && n.pageId) void followLink({ page: n.pageId, block: n.blockId });
  };
  const openPage = (pageId: string, blockId?: string) => {
    closeNav();
    void followLink({ page: pageId, block: blockId });
  };
  const title = (id: string) => labels.get(id) ?? 'Missing';
  const sources = (e: SceneEdge) =>
    (e.via ?? []).map((v) => {
      const from = pages[rawId(e.from)]?.blocks.find((b) => b.id === v.fromBlock);
      const to = v.toBlock ? pages[rawId(e.to)]?.blocks.find((b) => b.id === v.toBlock) : null;
      return { fromLabel: from ? boxLabel(from) : 'a box', toLabel: to ? boxLabel(to) : 'the whole page', v };
    });
  const tree = prefs.layout === 'tree';

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeNav()}>
      <div className="dialog graphview" role="dialog" aria-label="Graph view">
        <header className="graph-head">
          <div className="graph-tabs" role="group" aria-label="Layout">
            <button aria-pressed={!tree} className={!tree ? 'on' : ''} onClick={() => setGraphPrefs({ layout: 'network' })}>Network</button>
            <button aria-pressed={tree} className={tree ? 'on' : ''} onClick={() => setGraphPrefs({ layout: 'tree' })}>Hierarchy</button>
          </div>
          <div className="graph-tools">
            <input ref={search} className="field" type="search" placeholder="Find a page, group, card or tag" aria-label="Find in the graph" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="btn small" aria-pressed={prefs.panelOpen} onClick={() => setGraphPrefs({ panelOpen: !prefs.panelOpen })}>{prefs.panelOpen ? 'Hide settings' : 'Settings'}</button>
          <button className="btn small" onClick={closeNav}>Close</button>
        </header>
        <div className={`graph-body${prefs.panelOpen ? '' : ' no-panel'}`}>
          {prefs.panelOpen && <GraphSettings prefs={prefs} groups={groups} tags={tags} groupId={groupId} setGroupId={setGroupId} tag={tag} setTag={setTag} hasHere={!!here} depth={depth} setDepth={setDepth} />}
          <div className="graph-main">
            {count === 0 ? (
              <p className="graph-empty">Nothing to show with these filters.</p>
            ) : scene.edges.length === 0 ? (
              <p className="graph-empty">No links yet. Use a box’s link button (or right-click → Links…), or type <code>[[Page title]]</code> in a note. Tags can be shown as dots too.</p>
            ) : null}
            <Scene3D tree={scene.tree} edges={scene.edges} groups={groups} prefs={prefs} here={here} query={query} onOpen={open} onEdge={setEdge} selectedEdge={edge} />
            {edge && (
              <div className="graph-edge-info" role="status">
                <strong>{title(edge.from)}</strong> → <strong>{title(edge.to)}</strong>
                {edge.kind === 'text' && !edge.via?.length && <span> — written as [[{title(edge.to)}]] in text</span>}
                {edge.kind === 'tag' && <span> — uses this tag</span>}
                <ul>
                  {sources(edge).map((s, i) => (
                    <li key={i}>
                      <button className="btn small" onClick={() => openPage(rawId(edge.from), s.v.fromBlock ?? undefined)}>{s.fromLabel}</button>
                      {' → '}
                      <button className="btn small" onClick={() => openPage(rawId(edge.to), s.v.toBlock ?? undefined)}>{s.toLabel}</button>
                    </li>
                  ))}
                </ul>
                <button className="btn small" onClick={() => setEdge(null)}>Close</button>
              </div>
            )}
            <p className="graph-key">{count} notes · ● page ■ group or library ▢ card ◆ tag · solid line = box link, dashed = [[text]] link, grey = belongs to</p>
          </div>
        </div>
      </div>
    </div>
  );
}
