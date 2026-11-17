/** The graph view's remembered settings (pure: reading what was saved, repairing anything odd). */
import { DEFAULT_FORCES, type Forces } from './graphSim';

export interface GraphPrefs {
  /** Which picture: the force graph, or the 3D hierarchy. */
  tab: 'graph' | 'tree';
  cards: boolean;
  boxes: boolean;
  text: boolean;
  tags: boolean;
  orphans: boolean;
  arrows: boolean;
  colorByGroup: boolean;
  /** Names appear only when zoomed in past this (0 = always). */
  labelZoom: number;
  nodeScale: number;
  linkWidth: number;
  forces: Forces;
  /** 3D: headings under pages, links drawn over the tree, slow turning. */
  headings: boolean;
  links3d: boolean;
  autoRotate: boolean;
  panelOpen: boolean;
}

export const DEFAULT_GRAPH_PREFS: GraphPrefs = {
  tab: 'graph', cards: true, boxes: true, text: true, tags: false, orphans: true, arrows: true, colorByGroup: true,
  labelZoom: 0.6, nodeScale: 1, linkWidth: 1, forces: DEFAULT_FORCES, headings: true, links3d: true, autoRotate: false, panelOpen: true,
};

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function cleanGraphPrefs(raw: unknown): GraphPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const f = (o.forces && typeof o.forces === 'object' ? o.forces : {}) as Record<string, unknown>;
  const d = DEFAULT_GRAPH_PREFS;
  return {
    tab: o.tab === 'tree' ? 'tree' : 'graph',
    cards: bool(o.cards, d.cards), boxes: bool(o.boxes, d.boxes), text: bool(o.text, d.text), tags: bool(o.tags, d.tags), orphans: bool(o.orphans, d.orphans),
    arrows: bool(o.arrows, d.arrows), colorByGroup: bool(o.colorByGroup, d.colorByGroup),
    labelZoom: num(o.labelZoom, d.labelZoom, 0, 3), nodeScale: num(o.nodeScale, d.nodeScale, 0.5, 2.5), linkWidth: num(o.linkWidth, d.linkWidth, 0.3, 4),
    forces: {
      center: num(f.center, d.forces.center, 0, 1), repel: num(f.repel, d.forces.repel, 0, 4), link: num(f.link, d.forces.link, 0, 1), distance: num(f.distance, d.forces.distance, 20, 300),
    },
    headings: bool(o.headings, d.headings), links3d: bool(o.links3d, d.links3d), autoRotate: bool(o.autoRotate, d.autoRotate), panelOpen: bool(o.panelOpen, d.panelOpen),
  };
}
