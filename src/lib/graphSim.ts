/**
 * The force layout behind the graph view (pure and deterministic: no random numbers, so the same notes always settle into the same
 * picture). Nodes push each other apart, links pull their ends together at a set distance, and a weak force toward the centre keeps loose
 * pieces from drifting away. `alpha` is the "heat": it falls each step, and the picture stops when it reaches `ALPHA_MIN`; dragging a node
 * heats it up again.
 */
export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** When set, the node is held there (being dragged, or pinned). */
  fx: number | null;
  fy: number | null;
  /** Radius, so big dots keep apart from each other. */
  r: number;
}

export interface SimLink {
  from: string;
  to: string;
}

export interface Forces {
  /** Pull toward the centre, 0 to 1. */
  center: number;
  /** How hard nodes push each other away. */
  repel: number;
  /** How hard a link pulls its ends toward its length, 0 to 1. */
  link: number;
  /** The length a link settles at, in pixels. */
  distance: number;
}

export const DEFAULT_FORCES: Forces = { center: 0.08, repel: 1, link: 0.5, distance: 70 };
export const ALPHA_MIN = 0.002;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300); // reaches ALPHA_MIN in about 300 steps
const VELOCITY_DECAY = 0.55;
const CUTOFF = 260; // nodes further apart than this do not push each other (and the grid cell is this wide)
const MAX_NODES = 2500;

export interface Sim {
  nodes: SimNode[];
  links: { a: SimNode; b: SimNode }[];
  alpha: number;
}

/** A starting layout on a spiral (the golden angle), in node order: spread out, never on top of each other, and the same every time. */
export function createSim(nodes: readonly { id: string; r: number }[], links: readonly SimLink[], previous?: ReadonlyMap<string, { x: number; y: number }>): Sim {
  const list = nodes.slice(0, MAX_NODES);
  const placed: SimNode[] = list.map((n, i) => {
    const old = previous?.get(n.id);
    const angle = i * 2.399963229728653;
    const radius = 14 * Math.sqrt(i + 0.5);
    return { id: n.id, x: old?.x ?? Math.cos(angle) * radius, y: old?.y ?? Math.sin(angle) * radius, vx: 0, vy: 0, fx: null, fy: null, r: n.r };
  });
  const byId = new Map(placed.map((n) => [n.id, n]));
  const ls: Sim['links'] = [];
  for (const l of links) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (a && b && a !== b) ls.push({ a, b });
  }
  return { nodes: placed, links: ls, alpha: 1 };
}

/** One step of the simulation. Returns false once it has settled. */
export function stepSim(sim: Sim, f: Forces): boolean {
  if (sim.alpha < ALPHA_MIN) return false;
  const { nodes, links, alpha } = sim;

  // Push apart: only nodes in the same or a neighbouring grid cell are compared, so a big graph does not cost n × n.
  const cells = new Map<number, SimNode[]>();
  const key = (cx: number, cy: number) => cx * 73856093 + cy * 19349663;
  for (const n of nodes) {
    const k = key(Math.floor(n.x / CUTOFF), Math.floor(n.y / CUTOFF));
    const c = cells.get(k);
    if (c) c.push(n);
    else cells.set(k, [n]);
  }
  const strength = 90 * f.repel;
  for (const a of nodes) {
    const cx = Math.floor(a.x / CUTOFF);
    const cy = Math.floor(a.y / CUTOFF);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const cell = cells.get(key(cx + dx, cy + dy));
        if (!cell) continue;
        for (const b of cell) {
          if (a === b) continue;
          let x = a.x - b.x;
          let y = a.y - b.y;
          let d2 = x * x + y * y;
          if (d2 > CUTOFF * CUTOFF) continue;
          if (d2 < 1) {
            // exactly on top of each other: separate along a direction taken from the ids, so it stays deterministic
            const s = (a.id < b.id ? 1 : -1) * 0.5;
            x = s;
            y = s;
            d2 = 2 * s * s;
          }
          const d = Math.sqrt(d2);
          const push = ((strength * (a.r + b.r)) / d2) * alpha;
          a.vx += (x / d) * push;
          a.vy += (y / d) * push;
        }
      }
  }
  // Pull linked nodes toward the link length.
  for (const { a, b } of links) {
    const x = b.x - a.x;
    const y = b.y - a.y;
    const d = Math.sqrt(x * x + y * y) || 1;
    const pull = ((d - f.distance) / d) * f.link * 0.5 * alpha;
    a.vx += x * pull;
    a.vy += y * pull;
    b.vx -= x * pull;
    b.vy -= y * pull;
  }
  for (const n of nodes) {
    n.vx -= n.x * f.center * 0.1 * alpha; // toward the middle
    n.vy -= n.y * f.center * 0.1 * alpha;
    if (n.fx !== null) (n.x = n.fx), (n.vx = 0);
    else {
      n.vx *= 1 - VELOCITY_DECAY;
      n.x += n.vx;
    }
    if (n.fy !== null) (n.y = n.fy), (n.vy = 0);
    else {
      n.vy *= 1 - VELOCITY_DECAY;
      n.y += n.vy;
    }
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) (n.x = 0), (n.y = 0), (n.vx = 0), (n.vy = 0);
  }
  sim.alpha *= 1 - ALPHA_DECAY;
  return true;
}

/** Heats the picture up again (after a drag, or when a setting changes) so it re-settles. */
export const reheat = (sim: Sim, to = 0.5) => void (sim.alpha = Math.max(sim.alpha, to));

/** Runs steps until it settles, or `max` steps (for tests and for a picture that must be ready at once). */
export function settle(sim: Sim, f: Forces, max = 400): number {
  let n = 0;
  while (n < max && stepSim(sim, f)) n++;
  return n;
}

/** The bounds of the picture, for fitting it in the window. */
export function bounds(nodes: readonly SimNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!nodes.length) return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r);
    minY = Math.min(minY, n.y - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  return { minX, minY, maxX, maxY };
}
