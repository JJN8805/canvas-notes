import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '../../types';
import { addBlock, beginGesture, endGesture, mutatePage, updateBlock, useNotes } from '../../store/notes';
import { closeNav } from '../../store/nav';
import { followLink } from '../../store/boxLinks';
import { boxLabel } from '../../lib/boxLinks';
import {
  DEPTH_MAX, DEPTH_MIN, DEPTH_STEP, applyDepth, boxCentre, boxSolid, chosenDepth, clampDepth, effectiveDepths, flattenDepth, followStacking, isLayerable, pageCentre, pointInQuad, rayPlaneZ, snippet, toPage, toWorld,
  visibleFaces, type FaceName,
} from '../../lib/space';
import { cameraPosition, clampPitch, project, unproject, type Camera, type P3 } from '../../lib/tree3d';
import { FACE_VIEW, VIEWS, VIEW_NAMES, arrived, cubeFaces, focusOn, glide, orbitBy, panBy, spinStep, viewCamera, viewOf, wheelFactor, zoomAt, type ViewName } from '../../lib/spaceCamera';
import { blockHeight, textToHtml } from '../../lib/util';

/** `var(--n-yellow)` as the colour the canvas needs (a canvas cannot read CSS variables itself). */
function resolve(el: Element, v: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? getComputedStyle(el).getPropertyValue(m[1]).trim() || '#888' : v;
}

/** What a browser check can ask the canvas: where each box is on screen (the picture has no elements to find). */
export interface SpaceScreenInfo {
  boxes: { id: string; x: number; y: number; w: number; depth: number; faces: string[] }[];
  cube: { name: string; x: number; y: number }[];
  selected: string | null;
  camera: { dist: number; yaw: number; pitch: number };
}

/** Where the camera is going (a glide), and how fast the picture is still turning after a flick. */
const START_CAMERA: Camera = { yaw: 0.45, pitch: -0.25, dist: 1400, target: { x: 0, y: 0, z: 0 } };
const TEXT_LEFT = 7;
/** The orientation cube in the corner: its centre (from the top-right) and half-size in pixels. */
const CUBE_AT = { fromRight: 58, fromTop: 58, size: 22 };

/**
 * A page's boxes in 3D. Each box keeps its place on the page and has a depth (nearer or further away): put what matters up front, what
 * is background behind, and see it all at once. Writing and editing stay flat: type a new note into the field at the top, or open a box
 * on the page itself. Drag a box to move it on its layer, Alt+drag (or the slider, or [ and ]) to change its depth, drag the empty
 * space to turn the picture, scroll to zoom, Shift+drag to move it.
 */
export function SpaceView({ pageId }: { pageId: string }) {
  const page = useNotes((s) => s.pages[pageId]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ ...START_CAMERA });
  const raf = useRef(0);
  const goal = useRef<Camera | null>(null);
  const hoverFace = useRef<string | null>(null);
  const spin = useRef<{ x: number; y: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; x: number; y: number } | null>(null);
  const orbit = useRef<{ x: number; y: number; lx: number; ly: number; vx: number; vy: number; pan: boolean; moved: number } | null>(null);
  const grab = useRef<{ id: string; mode: 'plane' | 'depth'; moved: number; startX: number; startY: number; startDepth: number; offX: number; offY: number; began: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [view, setView] = useState<ViewName | null>('angled');
  const fitted = useRef(false);

  const blocks = useMemo(() => page?.blocks ?? [], [page]);
  const origin = useMemo(() => pageCentre(blocks), [blocks]);
  const depths = useMemo(() => effectiveDepths(blocks), [blocks]);
  const chosen = blocks.find((b) => b.id === selected) ?? null;
  const dataRef = useRef({ blocks, origin, depths, selected, hover, sheet: page?.sheet ?? null });
  dataRef.current = { blocks, origin, depths, selected, hover, sheet: page?.sheet ?? null };

  /** Where each box is on screen: its front face, and every face of the block that turns toward the camera. Nearest box first. */
  const quads = useCallback((w: number, h: number) => {
    const d = dataRef.current;
    const eye = cameraPosition(cam.current);
    const out: { b: Block; q: { x: number; y: number }[]; faces: { name: FaceName; poly: { x: number; y: number }[] }[]; frontVisible: boolean; depth: number; scale: number }[] = [];
    for (const b of d.blocks) {
      const dep = d.depths.get(b.id) ?? 0;
      const solid = boxSolid(b, d.origin, dep);
      const pts = solid.map((p) => project(p, cam.current, w, h));
      if (pts.some((p) => !p)) continue;
      const P = pts as NonNullable<(typeof pts)[number]>[];
      const q = [P[0], P[1], P[2], P[3]];
      const c = project(boxCentre(b, d.origin, dep), cam.current, w, h);
      // A frame is a backdrop: it sorts by its far edge, so it is always behind the boxes inside it (its centre can be nearer than a box at its side).
      const depth = b.type === 'frame' ? Math.max(...q.map((p) => p.depth)) : (c?.depth ?? q[0].depth);
      const visible = visibleFaces(solid, eye);
      out.push({
        b,
        q,
        faces: visible.map((f) => ({ name: f.name, poly: f.corners.map((i) => P[i]) })),
        frontVisible: visible.some((f) => f.name === 'front'),
        depth,
        scale: q.reduce((s, p) => s + p.scale, 0) / 4,
      });
    }
    return out.sort((a, b) => a.depth - b.depth);
  }, []);

  const draw = useCallback(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const d = dataRef.current;
    const colours = new Map<string, string>();
    const col = (v: string) => colours.get(v) ?? (colours.set(v, resolve(el, v)), colours.get(v)!);
    const ink = col('var(--ink)');
    const rule = col('var(--rule)');
    const accent = col('var(--accent)');
    const sheet = col('var(--sheet)');
    const grey = col('var(--graphite)');

    // The page itself: the layer at depth 0, drawn as its edges (or a frame around the boxes when the page has none).
    const bounds = d.sheet
      ? { x: d.sheet.x, y: d.sheet.y, w: d.sheet.w, h: d.sheet.h }
      : (() => {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const b of d.blocks) (minX = Math.min(minX, b.x), minY = Math.min(minY, b.y), maxX = Math.max(maxX, b.x + b.w), maxY = Math.max(maxY, b.y + blockHeight(b)));
          return Number.isFinite(minX) ? { x: minX - 60, y: minY - 60, w: maxX - minX + 120, h: maxY - minY + 120 } : null;
        })();
    if (bounds) {
      const plane = [toWorld(bounds.x, bounds.y, 0, d.origin), toWorld(bounds.x + bounds.w, bounds.y, 0, d.origin), toWorld(bounds.x + bounds.w, bounds.y + bounds.h, 0, d.origin), toWorld(bounds.x, bounds.y + bounds.h, 0, d.origin)].map((p) => project(p, cam.current, w, h));
      if (plane.every(Boolean)) {
        ctx.beginPath();
        plane.forEach((p, i) => (i ? ctx.lineTo(p!.x, p!.y) : ctx.moveTo(p!.x, p!.y)));
        ctx.closePath();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = sheet;
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = rule;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    const items = quads(w, h).reverse(); // far boxes first, so near ones cover them
    // A thin line from each box down to the page layer shows how far from it the box floats.
    ctx.lineWidth = 1;
    for (const { b } of items) {
      const dep = d.depths.get(b.id) ?? 0;
      if (!dep || b.type === 'frame') continue;
      const top = project(boxCentre(b, d.origin, dep), cam.current, w, h);
      const c = boxCentre(b, d.origin, dep);
      const base = project({ x: c.x, y: c.y, z: 0 }, cam.current, w, h);
      if (!top || !base) continue;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = dep > 0 ? accent : grey;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(base.x, base.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(base.x, base.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }

    for (const { b, q, faces, frontVisible, scale } of items) {
      const dep = d.depths.get(b.id) ?? 0;
      const isFrame = b.type === 'frame';
      const tint = !isFrame && b.tint ? b.tint : b.type === 'note' && b.style === 'sticky' ? 'yellow' : null;
      const fill = isFrame ? null : tint ? col(`var(--n-${tint})`) : sheet;
      const text = tint ? col(`var(--n-${tint}-ink)`) : ink;
      const on = b.id === d.selected;
      const near = b.id === d.hover;
      // Boxes further away fade a little, so what is in front stands out.
      ctx.globalAlpha = isFrame ? 0.7 : Math.max(0.6, Math.min(1, 1 + dep / 2400));
      ctx.lineWidth = on ? 3 : near ? 2 : 1.2;
      ctx.strokeStyle = on ? accent : near ? ink : isFrame ? grey : rule;
      ctx.lineJoin = 'round';
      // A box is a block: the faces turned toward you, the sides shaded so it reads as solid (a frame is only a thin backdrop).
      for (const f of isFrame ? [] : faces) {
        ctx.beginPath();
        f.poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = fill!;
        ctx.fill();
        const shade = f.name === 'top' ? 'rgba(255,255,255,0.28)' : f.name === 'bottom' ? 'rgba(0,0,0,0.38)' : f.name === 'left' ? 'rgba(0,0,0,0.2)' : f.name === 'right' ? 'rgba(0,0,0,0.3)' : f.name === 'back' ? 'rgba(0,0,0,0.4)' : '';
        if (shade) {
          ctx.fillStyle = shade;
          ctx.fill();
        }
        ctx.stroke();
      }
      if (isFrame) {
        ctx.beginPath();
        q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      // The words, kept inside the box's outline.
      const wpx = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
      const hpx = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
      if ((frontVisible || isFrame) && wpx >= 38 && hpx >= 16) {
        const size = Math.max(8, Math.min(14, 13 * scale));
        ctx.save();
        ctx.clip();
        ctx.fillStyle = text;
        ctx.font = `${isFrame ? 600 : 400} ${size}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        const words = (isFrame ? boxLabel(b) : snippet(b)).split(/(\s+)/);
        const room = wpx - TEXT_LEFT * 2;
        const maxLines = Math.max(1, Math.floor((hpx - 8) / (size * 1.25)));
        let line = '';
        let y = q[0].y + size + 4;
        let lines = 0;
        for (const word of words) {
          if (word.includes('\n')) {
            ctx.fillText(line, q[0].x + TEXT_LEFT, y);
            line = '';
            y += size * 1.25;
            if (++lines >= maxLines) break;
            continue;
          }
          if (line && ctx.measureText(line + word).width > room) {
            ctx.fillText(line, q[0].x + TEXT_LEFT, y);
            line = word.trimStart();
            y += size * 1.25;
            if (++lines >= maxLines) break;
          } else line += word;
        }
        if (lines < maxLines && line) ctx.fillText(line, q[0].x + TEXT_LEFT, y);
        ctx.restore();
      }
      if (dep && frontVisible && wpx >= 38) {
        ctx.globalAlpha = 1;
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = dep > 0 ? accent : grey;
        ctx.fillText(`${dep > 0 ? '+' : '−'}${Math.abs(dep)}`, q[1].x - 4, q[1].y - 4);
      }
    }
    ctx.globalAlpha = 1;
    // The orientation cube: click a face to look from that side.
    const gx = w - CUBE_AT.fromRight;
    const gy = CUBE_AT.fromTop;
    for (const f of cubeFaces(cam.current, CUBE_AT.size)) {
      ctx.beginPath();
      f.poly.forEach((p, i) => (i ? ctx.lineTo(gx + p.x, gy + p.y) : ctx.moveTo(gx + p.x, gy + p.y)));
      ctx.closePath();
      ctx.fillStyle = f.name === 'front' || f.name === 'top' ? sheet : f.name === 'back' || f.name === 'bottom' ? col('var(--desk)') : col('var(--hover)');
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = f.name === hoverFace.current ? accent : rule;
      ctx.lineWidth = f.name === hoverFace.current ? 2 : 1;
      ctx.stroke();
      ctx.fillStyle = f.name === hoverFace.current ? accent : ink;
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.name.toUpperCase(), gx + f.centre.x, gy + f.centre.y + 3);
    }
  }, [quads]);

  const schedule = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      let busy = false;
      if (goal.current) {
        cam.current = glide(cam.current, goal.current, 0.2);
        if (arrived(cam.current, goal.current)) {
          cam.current = goal.current;
          goal.current = null;
          setView(viewOf(cam.current));
        } else busy = true;
      }
      if (spin.current && !orbit.current) {
        cam.current = orbitBy(cam.current, spin.current.x, spin.current.y);
        spin.current = spinStep(spin.current);
        if (spin.current) busy = true;
        else setView(viewOf(cam.current));
      }
      draw();
      if (busy) scheduleRef.current();
    });
  }, [draw]);
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0; // (React's development double-run would otherwise leave a dead id that blocks every later frame)
    },
    [],
  );
  useEffect(() => schedule(), [blocks, selected, hover, schedule]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      goal.current = null;
      spin.current = null;
      cam.current = zoomAt(cam.current, wheelFactor(e.deltaY, e.ctrlKey), e.clientX - r.left, e.clientY - r.top, r.width, r.height); // toward the pointer
      setView(null);
      scheduleRef.current();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    const ro = new ResizeObserver(() => scheduleRef.current());
    ro.observe(el);
    return () => (el.removeEventListener('wheel', wheel), ro.disconnect());
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeNav();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const fit = useCallback(() => {
    const d = dataRef.current;
    const pts: P3[] = [];
    for (const b of d.blocks) pts.push(...boxSolid(b, d.origin, d.depths.get(b.id) ?? 0));
    pts.push({ x: 0, y: 0, z: 0 });
    goalFor(focusOn(pts, { ...cam.current, yaw: START_CAMERA.yaw, pitch: START_CAMERA.pitch }, 2.1));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Fly to a camera (the picture glides there). */
  const goalFor = (to: Camera, now = false) => {
    spin.current = null;
    if (now) cam.current = to;
    else goal.current = to;
    schedule();
  };
  /** Fly to the selected box (or everything when nothing is selected), keeping the way you are looking. */
  const flyTo = (id: string | null) => {
    const d = dataRef.current;
    const b = id ? d.blocks.find((x) => x.id === id) : null;
    if (!b) return fit();
    goalFor(focusOn(boxSolid(b, d.origin, d.depths.get(b.id) ?? 0), cam.current, 2.6));
  };
  const lookFrom = (name: ViewName) => {
    setView(name);
    canvas.current?.focus(); // so the number keys keep working after a click on a button
    goalFor(viewCamera(goal.current ?? cam.current, name));
  };
  useEffect(() => {
    if (!fitted.current && blocks.length) {
      fitted.current = true;
      const d = dataRef.current;
      const pts: P3[] = [{ x: 0, y: 0, z: 0 }];
      for (const b of d.blocks) pts.push(...boxSolid(b, d.origin, d.depths.get(b.id) ?? 0));
      goalFor(focusOn(pts, { ...cam.current, yaw: START_CAMERA.yaw, pitch: START_CAMERA.pitch }, 2.1), true); // the first fit is not a flight
    }
  }, [blocks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- changing things (each one goes through the page store, so undo and sync work as usual) ---- */
  const setDepthOf = (id: string, depth: number | null, merge = true) =>
    updateBlock(pageId, id, (b) => void applyDepth([b as never], [id], depth), { history: merge ? { key: `space-depth:${id}` } : 'none' });
  const restack = () => mutatePage(pageId, (p) => void followStacking(p.blocks as never));
  const flatten = () => mutatePage(pageId, (p) => void flattenDepth(p.blocks as never));
  const edit = (id: string) => {
    closeNav();
    void followLink({ page: pageId, block: id });
  };
  const write = () => {
    const t = text.trim();
    if (!t) return;
    const o = dataRef.current.origin;
    const n = dataRef.current.blocks.length % 8;
    const id = addBlock(pageId, 'sticky', { x: o.x - 100 + n * 28, y: o.y - 100 + n * 28 }, { html: textToHtml(t), ...(chosen ? { depth: dataRef.current.depths.get(chosen.id) ?? 0 } : {}) });
    setText('');
    if (id) setSelected(id);
  };

  /* ---- pointer ---- */
  const pos = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };
  const boxAt = (e: { clientX: number; clientY: number }) => {
    const p = pos(e);
    return quads(p.w, p.h).find((i) => pointInQuad(p.x, p.y, i.q) || i.faces.some((f) => pointInQuad(p.x, p.y, f.poly)))?.b ?? null;
  };
  /** Which face of the orientation cube is under the pointer, if any. */
  const faceAt = (e: { clientX: number; clientY: number }) => {
    const p = pos(e);
    const gx = p.w - CUBE_AT.fromRight;
    const gy = CUBE_AT.fromTop;
    const hit = cubeFaces(cam.current, CUBE_AT.size).reverse().find((f) => pointInQuad(p.x - gx, p.y - gy, f.poly));
    return hit?.name ?? null;
  };
  /** Where the pointer is on the layer a box sits in (world coordinates). */
  const onLayer = (e: { clientX: number; clientY: number }, depth: number) => {
    const p = pos(e);
    const c = cam.current;
    return rayPlaneZ(unproject(p.x, p.y, c.dist * 0.5, c, p.w, p.h), unproject(p.x, p.y, c.dist * 1.5, c, p.w, p.h), -depth);
  };

  const press = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    canvas.current!.focus();
    goal.current = null;
    spin.current = null;
    // Two fingers: pinch to zoom, slide to move (a grab or a turn that began with the first finger is dropped).
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        grab.current = null;
        orbit.current = null;
        const [a, b2] = [...touches.current.values()];
        pinch.current = { dist: Math.hypot(a.x - b2.x, a.y - b2.y), x: (a.x + b2.x) / 2, y: (a.y + b2.y) / 2 };
        return;
      }
    }
    const face = e.button === 0 ? faceAt(e) : null;
    if (face) {
      setView(null);
      goalFor({ ...(goal.current ?? cam.current), ...FACE_VIEW[face] });
      return;
    }
    const pan = e.shiftKey || e.button === 1 || e.button === 2;
    const b = pan ? null : boxAt(e);
    if (b) {
      setSelected(b.id);
      if (isLayerable(b)) {
        const dep = dataRef.current.depths.get(b.id) ?? 0;
        const hit = onLayer(e, dep);
        const c = boxCentre(b, dataRef.current.origin, dep);
        grab.current = { id: b.id, mode: e.altKey ? 'depth' : 'plane', moved: 0, startX: e.clientX, startY: e.clientY, startDepth: dep, offX: hit ? c.x - hit.x : 0, offY: hit ? c.y - hit.y : 0, began: false };
      }
      return;
    }
    orbit.current = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, vx: 0, vy: 0, pan, moved: 0 };
    canvas.current!.style.cursor = 'grabbing';
  };
  const move = (e: React.PointerEvent) => {
    if (touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pi = pinch.current;
      if (pi && touches.current.size >= 2) {
        const [a, b2] = [...touches.current.values()];
        const dist = Math.hypot(a.x - b2.x, a.y - b2.y);
        const mx = (a.x + b2.x) / 2;
        const my = (a.y + b2.y) / 2;
        const r = canvas.current!.getBoundingClientRect();
        let c = zoomAt(cam.current, pi.dist / Math.max(dist, 1), mx - r.left, my - r.top, r.width, r.height);
        c = panBy(c, mx - pi.x, my - pi.y, r.width, r.height);
        cam.current = c;
        pinch.current = { dist, x: mx, y: my };
        setView(null);
        schedule();
        return;
      }
    }
    const g = grab.current;
    if (g) {
      g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.startX, e.clientY - g.startY));
      if (g.moved < 4) return;
      const b = dataRef.current.blocks.find((x) => x.id === g.id);
      if (!b) return;
      if (!g.began) {
        g.began = true;
        beginGesture(pageId); // the whole drag is one undo step
      }
      if (g.mode === 'depth') {
        setDepthOf(g.id, clampDepth(Math.round((g.startDepth + (g.startY - e.clientY) * 1.5) / 5) * 5), false);
      } else {
        const hit = onLayer(e, dataRef.current.depths.get(b.id) ?? 0);
        if (!hit) return;
        const at = toPage(hit.x + g.offX, hit.y + g.offY, dataRef.current.origin);
        updateBlock(pageId, g.id, (x) => ((x.x = Math.round(at.x - x.w / 2)), (x.y = Math.round(at.y - blockHeight(x as Block) / 2))), { history: 'none' });
      }
      return;
    }
    const o = orbit.current;
    if (o) {
      const dx = e.clientX - o.lx;
      const dy = e.clientY - o.ly;
      o.lx = e.clientX;
      o.ly = e.clientY;
      o.moved = Math.max(o.moved, Math.hypot(e.clientX - o.x, e.clientY - o.y));
      o.vx = o.vx * 0.5 + dx * 0.5; // the recent speed, for the glide after a flick
      o.vy = o.vy * 0.5 + dy * 0.5;
      if (o.pan) {
        const r = canvas.current!.getBoundingClientRect();
        cam.current = panBy(cam.current, dx, dy, r.width, r.height);
      } else cam.current = orbitBy(cam.current, dx, dy);
      setView(null);
      schedule();
      return;
    }
    const face = faceAt(e);
    if (face !== hoverFace.current) {
      hoverFace.current = face;
      schedule();
      canvas.current!.style.cursor = face ? 'pointer' : 'grab';
    }
    const b = face ? null : boxAt(e);
    const id = b?.id ?? null;
    if (id !== hover) {
      setHover(id);
      canvas.current!.style.cursor = b ? (isLayerable(b) ? 'move' : 'pointer') : 'grab';
    }
  };
  const release = (e?: React.PointerEvent) => {
    if (e && touches.current.delete(e.pointerId)) {
      if (touches.current.size < 2) pinch.current = null;
      if (touches.current.size) return;
    }
    const g = grab.current;
    grab.current = null;
    if (g?.began) {
      const p = useNotes.getState().pages[pageId];
      if (p) endGesture(pageId);
    }
    const o = orbit.current;
    orbit.current = null;
    if (o && o.moved < 4) setSelected(null);
    // A flick keeps the picture turning for a moment, slowing down (not when the pointer rested before letting go).
    if (o && !o.pan && o.moved >= 4 && Math.hypot(o.vx, o.vy) > 1.5) {
      spin.current = { x: o.vx, y: o.vy };
      schedule();
    }
    if (o && canvas.current) canvas.current.style.cursor = 'grab';
  };

  useEffect(() => {
    const el = canvas.current as (HTMLCanvasElement & { __screen?: () => SpaceScreenInfo }) | null;
    if (!el) return;
    el.__screen = () => {
      const r = el.getBoundingClientRect();
      return {
        boxes: quads(r.width, r.height).map((i) => ({ id: i.b.id, x: r.left + (i.q[0].x + i.q[2].x) / 2, y: r.top + (i.q[0].y + i.q[2].y) / 2, w: Math.hypot(i.q[1].x - i.q[0].x, i.q[1].y - i.q[0].y), depth: dataRef.current.depths.get(i.b.id) ?? 0, faces: i.faces.map((f) => f.name) })),
        cube: cubeFaces(cam.current, CUBE_AT.size).map((f) => ({ name: f.name, x: r.left + r.width - CUBE_AT.fromRight + f.centre.x, y: r.top + CUBE_AT.fromTop + f.centre.y })),
        selected: dataRef.current.selected,
        camera: { dist: cam.current.dist, yaw: cam.current.yaw, pitch: cam.current.pitch },
      };
    };
  });

  if (!page) return null;
  const depth = chosen ? (depths.get(chosen.id) ?? 0) : 0;
  const followed = !!chosen && chosenDepth(chosen) === null;
  const layerable = !!chosen && isLayerable(chosen);
  const anyChosen = blocks.some((b) => b.depth !== undefined);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeNav()}>
      <div className="dialog spaceview" role="dialog" aria-label="3D view of this page">
        <header className="graph-head">
          <strong className="space-title">{page.title.trim() || 'Untitled'} in 3D</strong>
          <form
            className="space-write"
            onSubmit={(e) => {
              e.preventDefault();
              write();
            }}
          >
            <input className="field" aria-label="Write a note here" placeholder="Write a note, press Enter: it appears in the picture" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn small" type="submit" disabled={!text.trim()}>Add note</button>
          </form>
          <button className="btn small" onClick={closeNav}>Close</button>
        </header>
        <div className="space-body">
          <aside className="graph-panel" aria-label="3D page settings">
            <section>
              <h3>Selected</h3>
              {chosen ? (
                <>
                  <p className="space-name" title={boxLabel(chosen)}>{boxLabel(chosen)}</p>
                  <label className="gp-slider">
                    <span>Depth: {depth > 0 ? `${depth} nearer` : depth < 0 ? `${-depth} further` : 'on the page'}{followed ? ' (follows the page)' : ''}</span>
                    <input type="range" aria-label="Depth" min={DEPTH_MIN} max={DEPTH_MAX} step={10} value={depth} disabled={!layerable} onChange={(e) => setDepthOf(chosen.id, Number(e.target.value))} />
                  </label>
                  <div className="space-btns">
                    <button className="btn small" disabled={!layerable} onClick={() => setDepthOf(chosen.id, depth + DEPTH_STEP, false)}>Bring nearer</button>
                    <button className="btn small" disabled={!layerable} onClick={() => setDepthOf(chosen.id, depth - DEPTH_STEP, false)}>Push back</button>
                    <button className="btn small" disabled={!layerable || (!followed && depth === 0)} onClick={() => setDepthOf(chosen.id, 0, false)}>On the page</button>
                    <button className="btn small" disabled={!layerable || followed} onClick={() => setDepthOf(chosen.id, null, false)} title="Go back to the page's own stacking: behind what is above it on the page">Follow the page</button>
                  </div>
                  <button className="btn small" onClick={() => edit(chosen.id)}>Edit on the page</button>
                  {!layerable && <p className="space-hint">{chosen.locked ? 'This box is locked.' : 'A frame stays on the page with what is inside it.'}</p>}
                </>
              ) : (
                <p className="space-hint">Boxes are solid blocks. A box that is behind another on the page is behind it here too. Click one to select it, drag it to move it on its layer, Alt+drag to bring it nearer or push it back.</p>
              )}
            </section>
            <section>
              <h3>View</h3>
              <div className="space-btns" role="group" aria-label="Look from">
                {VIEW_NAMES.map((n) => (
                  <button key={n} className={`btn small${view === n ? ' on' : ''}`} aria-pressed={view === n} title={`${VIEWS[n].label} view (${VIEWS[n].key})`} onClick={() => lookFrom(n)}>
                    {VIEWS[n].label}
                  </button>
                ))}
              </div>
              <div className="space-btns">
                <button className="btn small" disabled={!chosen} title="Fly to the selected box (F)" onClick={() => flyTo(selected)}>Focus selected</button>
                <button className="btn small" title="Show everything (0)" onClick={fit}>Fit</button>
              </div>
            </section>
            <section>
              <h3>This page</h3>
              <button className="btn small" disabled={!anyChosen} onClick={restack} title="Every box follows the page's own stacking again: a box behind another on the page is behind it here">Layer like the page</button>
              <button className="btn small" onClick={flatten} title="Put every box on the page layer, side by side">Put everything on the page</button>
            </section>
            <section>
              <details className="space-why">
                <summary>Why depth?</summary>
                <p className="space-hint">Where something sits helps you find and remember it. Write and edit on the page itself, where text is easiest to read: use depth to arrange, not to type. A depth you choose is kept; the rest follows the page.</p>
              </details>
            </section>
          </aside>
          <div className="tree3d-stage">
            <canvas
              ref={canvas}
              className="tree3d-canvas"
              tabIndex={0}
              role="img"
              aria-label="The boxes of this page in 3D: drag a box to move it, Alt+drag to change its depth, drag the empty space to turn the picture, scroll to zoom, double-click a box to fly to it."
              onPointerDown={press}
              onPointerMove={move}
              onPointerUp={release}
              onPointerCancel={release}
              onContextMenu={(e) => e.preventDefault()}
              onPointerLeave={() => setHover(null)}
              onDoubleClick={(e) => {
                const b = boxAt(e);
                if (b) {
                  setSelected(b.id);
                  flyTo(b.id); // fly to it and make it the pivot; Enter (or the button) opens it on the page
                } else fit();
              }}
              onKeyDown={(e) => {
                const c = cam.current;
                const r = canvas.current!.getBoundingClientRect();
                const named = VIEW_NAMES.find((n) => VIEWS[n].key === e.key);
                if (named) lookFrom(named);
                else if (e.key === 'f' || e.key === 'F') flyTo(selected);
                else if (e.shiftKey && e.key.startsWith('Arrow')) {
                  const s = 60;
                  cam.current = panBy(c, e.key === 'ArrowLeft' ? s : e.key === 'ArrowRight' ? -s : 0, e.key === 'ArrowUp' ? s : e.key === 'ArrowDown' ? -s : 0, r.width, r.height);
                  setView(null);
                } else if (e.key === ']' && chosen && isLayerable(chosen)) setDepthOf(chosen.id, depth + DEPTH_STEP, false);
                else if (e.key === '[' && chosen && isLayerable(chosen)) setDepthOf(chosen.id, depth - DEPTH_STEP, false);
                else if (e.key === 'Enter' && chosen) return edit(chosen.id);
                else if (e.key === 'ArrowLeft') cam.current = { ...c, yaw: c.yaw + 0.12 };
                else if (e.key === 'ArrowRight') cam.current = { ...c, yaw: c.yaw - 0.12 };
                else if (e.key === 'ArrowUp') cam.current = { ...c, pitch: clampPitch(c.pitch - 0.1) };
                else if (e.key === 'ArrowDown') cam.current = { ...c, pitch: clampPitch(c.pitch + 0.1) };
                else if (e.key === '+' || e.key === '=') cam.current = zoomAt(c, 0.85, r.width / 2, r.height / 2, r.width, r.height);
                else if (e.key === '-') cam.current = zoomAt(c, 1 / 0.85, r.width / 2, r.height / 2, r.width, r.height);
                else if (e.key === '0' || e.key === 'Home') return fit();
                else return;
                e.preventDefault();
                schedule();
              }}
            />
            {blocks.length === 0 && <p className="graph-empty">This page has no boxes yet. Write a note above and it will appear here.</p>}
            <div className="tree3d-help" aria-hidden="true">Drag the space to turn, or click the cube · Scroll zooms toward the pointer · Right-drag or Shift+drag slides · Double-click a box to fly to it, empty space to fit · 1–4 views · F focus · Enter edits · Alt+drag or [ ] set depth</div>
          </div>
        </div>
      </div>
    </div>
  );
}
