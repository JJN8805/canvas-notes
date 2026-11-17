import { clampDist, clampPitch, frame, unproject, type Camera, type P3 } from './tree3d';

/**
 * How the camera of the 3D page view moves (pure, so it is tested without a screen). Conventions taken from what people already know
 * from CAD, Blender, Sketchfab and map viewers: the scroll wheel zooms toward the pointer (what is under it stays under it), a drag
 * on the empty space turns the picture around a pivot, a right/middle drag or Shift+drag grabs the world and slides it, a double-click
 * flies to what you point at, and a few named views (front, top, side, angled) are one key away. Every move glides.
 */

/** The named views. `front` looks at the page head-on (as when editing), the others show how far apart the layers are. */
export const VIEWS = {
  angled: { yaw: 0.45, pitch: -0.25, label: 'Angled', key: '1' },
  front: { yaw: 0, pitch: 0, label: 'Front', key: '2' },
  side: { yaw: -Math.PI / 2, pitch: 0, label: 'Side', key: '3' },
  top: { yaw: 0, pitch: -1.4, label: 'Top', key: '4' },
} as const;
export type ViewName = keyof typeof VIEWS;
export const VIEW_NAMES = Object.keys(VIEWS) as ViewName[];

/** The same camera looking from a named view (same pivot and distance). */
export const viewCamera = (c: Camera, name: ViewName): Camera => ({ ...c, yaw: VIEWS[name].yaw, pitch: VIEWS[name].pitch });

/** Which named view the camera is (nearly) in, if any, to mark its button. */
export function viewOf(c: Camera): ViewName | null {
  for (const n of VIEW_NAMES) if (Math.abs(angleDiff(c.yaw, VIEWS[n].yaw)) < 0.03 && Math.abs(c.pitch - VIEWS[n].pitch) < 0.03) return n;
  return null;
}

/** The shortest signed turn from one angle to another (so a glide never spins the long way round). */
export function angleDiff(from: number, to: number): number {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
}

/** A camera moved a fraction of the way to another: position, distance and the turn (by the short way). */
export function glide(from: Camera, to: Camera, k: number): Camera {
  return {
    yaw: from.yaw + angleDiff(from.yaw, to.yaw) * k,
    pitch: from.pitch + (to.pitch - from.pitch) * k,
    dist: from.dist + (to.dist - from.dist) * k,
    target: { x: from.target.x + (to.target.x - from.target.x) * k, y: from.target.y + (to.target.y - from.target.y) * k, z: from.target.z + (to.target.z - from.target.z) * k },
  };
}

/** True once a glide is close enough to its goal to stop. */
export function arrived(a: Camera, b: Camera): boolean {
  return Math.abs(angleDiff(a.yaw, b.yaw)) < 0.002 && Math.abs(a.pitch - b.pitch) < 0.002 && Math.abs(a.dist - b.dist) < 0.5 && Math.hypot(a.target.x - b.target.x, a.target.y - b.target.y, a.target.z - b.target.z) < 0.5;
}

/** How much one wheel notch zooms: a trackpad pinch (reported as Ctrl+wheel) sends small steps, so it is made more sensitive. */
export const wheelFactor = (deltaY: number, pinch = false): number => Math.exp(Math.max(-240, Math.min(240, deltaY)) * (pinch ? 0.01 : 0.0012));

/**
 * Zoom by `factor` (below 1 = nearer) keeping the point under the pointer where it is on screen: the pivot slides toward that point
 * by the share the distance shrank. Without it the picture zooms into its centre and what you point at slides away.
 */
export function zoomAt(c: Camera, factor: number, sx: number, sy: number, w: number, h: number): Camera {
  const dist = clampDist(c.dist * factor);
  const ratio = dist / c.dist;
  const under = unproject(sx, sy, c.dist, c, w, h); // the point under the pointer on the plane through the pivot
  const k = 1 - ratio;
  return { ...c, dist, target: { x: c.target.x + (under.x - c.target.x) * k, y: c.target.y + (under.y - c.target.y) * k, z: c.target.z + (under.z - c.target.z) * k } };
}

/** Slide the picture by a screen movement: the world follows the pointer (what you grabbed stays under it). */
export function panBy(c: Camera, dx: number, dy: number, w: number, h: number): Camera {
  const a = unproject(w / 2, h / 2, c.dist, c, w, h);
  const b = unproject(w / 2 + dx, h / 2 + dy, c.dist, c, w, h);
  return { ...c, target: { x: c.target.x - (b.x - a.x), y: c.target.y - (b.y - a.y), z: c.target.z - (b.z - a.z) } };
}

/** Turn by a screen movement; the picture never turns over (pitch is limited). */
export const orbitBy = (c: Camera, dx: number, dy: number): Camera => ({ ...c, yaw: c.yaw - dx * 0.008, pitch: clampPitch(c.pitch + dy * 0.008) });

/** A camera looking at some points (a box, or everything) from where it is now: the goal of "fly to". */
export function focusOn(points: Iterable<P3>, c: Camera, margin: number): Camera {
  return frame(points, c, margin);
}

/** Keep turning for a moment after the pointer is let go: the speed (pixels per frame) and what is left of it after a frame. */
export const SPIN_DECAY = 0.92;
export const spinStep = (v: { x: number; y: number }): { x: number; y: number } | null => {
  const next = { x: v.x * SPIN_DECAY, y: v.y * SPIN_DECAY };
  return Math.hypot(next.x, next.y) < 0.15 ? null : next;
};

/** The way to look so that a face of the corner cube faces you (Autodesk's ViewCube: click a face to look from there). */
export const FACE_VIEW: Record<'front' | 'back' | 'left' | 'right' | 'top' | 'bottom', { yaw: number; pitch: number }> = {
  front: { yaw: 0, pitch: 0 },
  back: { yaw: Math.PI, pitch: 0 },
  left: { yaw: Math.PI / 2, pitch: 0 },
  right: { yaw: -Math.PI / 2, pitch: 0 },
  top: { yaw: 0, pitch: -1.4 },
  bottom: { yaw: 0, pitch: 1.4 },
};

const CUBE: [number, number, number][] = [[-1, 1, -1], [1, 1, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]];
const CUBE_FACES: { name: keyof typeof FACE_VIEW; corners: number[]; normal: [number, number, number] }[] = [
  { name: 'front', corners: [0, 1, 2, 3], normal: [0, 0, -1] },
  { name: 'back', corners: [4, 5, 6, 7], normal: [0, 0, 1] },
  { name: 'top', corners: [0, 1, 5, 4], normal: [0, 1, 0] },
  { name: 'bottom', corners: [3, 2, 6, 7], normal: [0, -1, 0] },
  { name: 'left', corners: [0, 3, 7, 4], normal: [-1, 0, 0] },
  { name: 'right', corners: [1, 2, 6, 5], normal: [1, 0, 0] },
];

/**
 * The small orientation cube for a camera: the faces turned toward the viewer as polygons around (0, 0), `size` pixels from the centre
 * to a face (orthographic, same turn as the picture). Each is a button that looks from that side.
 */
export function cubeFaces(c: Pick<Camera, 'yaw' | 'pitch'>, size: number): { name: keyof typeof FACE_VIEW; poly: { x: number; y: number }[]; centre: { x: number; y: number } }[] {
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const turn = ([x, y, z]: [number, number, number]) => {
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    return { x: x1, y: y * cp - z1 * sp, z: y * sp + z1 * cp }; // larger z = further from the viewer
  };
  const pts = CUBE.map((p) => turn(p));
  return CUBE_FACES.filter((f) => turn(f.normal).z < -1e-6).map((f) => {
    const poly = f.corners.map((i) => ({ x: pts[i].x * size, y: -pts[i].y * size }));
    return { name: f.name, poly, centre: { x: poly.reduce((s, p) => s + p.x, 0) / 4, y: poly.reduce((s, p) => s + p.y, 0) / 4 } };
  });
}
