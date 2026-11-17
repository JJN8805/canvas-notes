/** The graph view's remembered settings (pure: reading what was saved, repairing anything odd). */
import { DEFAULT_FORCES, type Forces } from './graphSim';

export interface GraphPrefs {
  /** How the same nodes are laid out: a live network, or the hierarchy (library → groups → pages). */
  layout: 'network' | 'tree';
  /** In the network: show the library, groups and the lines from each to what it holds (the hierarchy layout always does). */
  hierarchy: boolean;
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
  /** Headings under pages, link lines, slow turning. */
  headings: boolean;
  showLinks: boolean;
  autoRotate: boolean;
  panelOpen: boolean;
}

export const DEFAULT_GRAPH_PREFS: GraphPrefs = {
  layout: 'network', hierarchy: true, cards: true, boxes: true, text: true, tags: false, orphans: true, arrows: true, colorByGroup: true,
  labelZoom: 0.7, nodeScale: 1, linkWidth: 1, forces: DEFAULT_FORCES, headings: false, showLinks: true, autoRotate: false, panelOpen: true,
};

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function cleanGraphPrefs(raw: unknown): GraphPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const f = (o.forces && typeof o.forces === 'object' ? o.forces : {}) as Record<string, unknown>;
  const d = DEFAULT_GRAPH_PREFS;
  return {
    layout: o.layout === 'tree' || o.layout === 'network' ? o.layout : o.tab === 'tree' ? 'tree' : 'network', // (`tab` is what older versions of this setting called it)
    hierarchy: bool(o.hierarchy, d.hierarchy),
    cards: bool(o.cards, d.cards), boxes: bool(o.boxes, d.boxes), text: bool(o.text, d.text), tags: bool(o.tags, d.tags), orphans: bool(o.orphans, d.orphans),
    arrows: bool(o.arrows, d.arrows), colorByGroup: bool(o.colorByGroup, d.colorByGroup),
    labelZoom: num(o.labelZoom, d.labelZoom, 0, 3), nodeScale: num(o.nodeScale, d.nodeScale, 0.5, 2.5), linkWidth: num(o.linkWidth, d.linkWidth, 0.3, 4),
    forces: {
      center: num(f.center, d.forces.center, 0, 1), repel: num(f.repel, d.forces.repel, 0, 4), link: num(f.link, d.forces.link, 0, 1), distance: num(f.distance, d.forces.distance, 20, 300),
    },
    headings: bool(o.headings, d.headings), showLinks: bool(o.showLinks ?? o.links3d, d.showLinks), autoRotate: bool(o.autoRotate, d.autoRotate), panelOpen: bool(o.panelOpen, d.panelOpen),
  };
}
