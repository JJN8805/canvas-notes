import type { Group } from '../../../types';
import { DEFAULT_FORCES } from '../../../lib/graphSim';
import type { GraphPrefs } from '../../../lib/graphPrefs';
import { groupTree } from '../../../lib/groups';
import { setGraphPrefs } from '../../../store/graphPrefs';

interface Props {
  prefs: GraphPrefs;
  groups: Group[];
  tags: string[];
  groupId: string;
  setGroupId: (v: string) => void;
  tag: string;
  setTag: (v: string) => void;
  /** The page the graph was opened from, if any (the local graph is around it). */
  hasHere: boolean;
  depth: 0 | 1 | 2 | 3;
  setDepth: (v: 0 | 1 | 2 | 3) => void;
}

const Check = ({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) => (
  <label className="gp-check">
    <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {label}
  </label>
);
const Slider = ({ label, value, min, max, step, set }: { label: string; value: number; min: number; max: number; step: number; set: (v: number) => void }) => (
  <label className="gp-slider">
    <span>{label}</span>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
  </label>
);

/** The side panel, as in Obsidian: what to show, how it looks, and how hard the forces pull and push. */
export function GraphSettings({ prefs, groups, tags, groupId, setGroupId, tag, setTag, hasHere, depth, setDepth }: Props) {
  const tree = prefs.tab === 'tree';
  return (
    <aside className="graph-panel" aria-label="Graph settings">
      <section>
        <h3>Filters</h3>
        {!tree && (
          <>
            <Check label="Tags" on={prefs.tags} set={(tags) => setGraphPrefs({ tags })} />
            <Check label="Orphans" on={prefs.orphans} set={(orphans) => setGraphPrefs({ orphans })} />
            <Check label="Cards" on={prefs.cards} set={(cards) => setGraphPrefs({ cards })} />
            <Check label="Box links" on={prefs.boxes} set={(boxes) => setGraphPrefs({ boxes })} />
            <Check label="[[Text]] links" on={prefs.text} set={(text) => setGraphPrefs({ text })} />
            <select className="field" aria-label="Only this group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">All groups</option>
              {groupTree(groups).map((r) => (
                <option key={r.group.id} value={r.group.id}>{'  '.repeat(r.depth)}{r.group.name}</option>
              ))}
            </select>
            <select className="field" aria-label="Only this tag" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">All tags</option>
              {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
            </select>
            {hasHere && (
              <select className="field" aria-label="How much to show" value={depth} onChange={(e) => setDepth(Number(e.target.value) as 0 | 1 | 2 | 3)}>
                <option value={0}>Everything</option>
                <option value={1}>Around this page (1 link)</option>
                <option value={2}>Around this page (2 links)</option>
                <option value={3}>Around this page (3 links)</option>
              </select>
            )}
          </>
        )}
        {tree && (
          <>
            <Check label="Headings under pages" on={prefs.headings} set={(headings) => setGraphPrefs({ headings })} />
            <Check label="Links drawn over the tree" on={prefs.links3d} set={(links3d) => setGraphPrefs({ links3d })} />
            <Check label="Box links" on={prefs.boxes} set={(boxes) => setGraphPrefs({ boxes })} />
            <Check label="[[Text]] links" on={prefs.text} set={(text) => setGraphPrefs({ text })} />
            <Check label="Turn slowly" on={prefs.autoRotate} set={(autoRotate) => setGraphPrefs({ autoRotate })} />
          </>
        )}
      </section>
      {!tree && (
        <>
          <section>
            <h3>Display</h3>
            <Check label="Arrows" on={prefs.arrows} set={(arrows) => setGraphPrefs({ arrows })} />
            <Check label="Colour by group" on={prefs.colorByGroup} set={(colorByGroup) => setGraphPrefs({ colorByGroup })} />
            <Slider label="Names appear when zoomed in" value={prefs.labelZoom} min={0} max={3} step={0.1} set={(labelZoom) => setGraphPrefs({ labelZoom })} />
            <Slider label="Dot size" value={prefs.nodeScale} min={0.5} max={2.5} step={0.1} set={(nodeScale) => setGraphPrefs({ nodeScale })} />
            <Slider label="Link thickness" value={prefs.linkWidth} min={0.3} max={4} step={0.1} set={(linkWidth) => setGraphPrefs({ linkWidth })} />
          </section>
          <section>
            <h3>Forces</h3>
            <Slider label="Centre force" value={prefs.forces.center} min={0} max={1} step={0.01} set={(center) => setGraphPrefs({ forces: { ...prefs.forces, center } })} />
            <Slider label="Repel force" value={prefs.forces.repel} min={0} max={4} step={0.05} set={(repel) => setGraphPrefs({ forces: { ...prefs.forces, repel } })} />
            <Slider label="Link force" value={prefs.forces.link} min={0} max={1} step={0.01} set={(link) => setGraphPrefs({ forces: { ...prefs.forces, link } })} />
            <Slider label="Link distance" value={prefs.forces.distance} min={20} max={300} step={5} set={(distance) => setGraphPrefs({ forces: { ...prefs.forces, distance } })} />
            <button className="btn small" onClick={() => setGraphPrefs({ forces: DEFAULT_FORCES })}>Reset forces</button>
          </section>
        </>
      )}
    </aside>
  );
}
