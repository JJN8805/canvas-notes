import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '../../types';
import { addBlock, beginGesture, endGesture, mutatePage, updateBlock, useNotes } from '../../store/notes';
import { closeNav } from '../../store/nav';
import { followLink } from '../../store/boxLinks';
import { boxLabel } from '../../lib/boxLinks';
import {
  DEPTH_MAX, DEPTH_MIN, DEPTH_STEP, applyDepth, boxCentre, boxCorners, clampDepth, depthOf, fanOut, flattenDepth, isLayerable, pageCentre, pointInQuad, rayPlaneZ, snippet, toPage, toWorld,
} from '../../lib/space';
import { clampDist, clampPitch, frame, project, unproject, type Camera, type P3 } from '../../lib/tree3d';
import { blockHeight, textToHtml } from '../../lib/util';

/** `var(--n-yellow)` as the colour the canvas needs (a canvas cannot read CSS variables itself). */
function resolve(el: Element, v: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? getComputedStyle(el).getPropertyValue(m[1]).trim() || '#888' : v;
}

/** What a browser check can ask the canvas: where each box is on screen (the picture has no elements to find). */
export interface SpaceScreenInfo {
  boxes: { id: string; x: number; y: number; w: number; depth: number }[];
  selected: string | null;
  camera: { dist: number; yaw: number; pitch: number };
}

const START_CAMERA: Camera = { yaw: 0.45, pitch: 0.22, dist: 1400, target: { x: 0, y: 0, z: 0 } };
const TEXT_LEFT = 7;

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
  const orbit = useRef<{ x: number; y: number; yaw: number; pitch: number; target: P3; shift: boolean; moved: number } | null>(null);
  const grab = useRef<{ id: string; mode: 'plane' | 'depth'; moved: number; startX: number; startY: number; startDepth: number; offX: number; offY: number; began: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [text, setText] = useState('');
  const fitted = useRef(false);

  const blocks = useMemo(() => page?.blocks ?? [], [page]);
  const origin = useMemo(() => pageCentre(blocks), [blocks]);
  const chosen = blocks.find((b) => b.id === selected) ?? null;
  const dataRef = useRef({ blocks, origin, selected, hover, sheet: page?.sheet ?? null });
  dataRef.current = { blocks, origin, selected, hover, sheet: page?.sheet ?? null };

  /** Where each box's four corners are on screen, nearest box first. */
  const quads = useCallback((w: number, h: number) => {
    const d = dataRef.current;
    const out: { b: Block; q: { x: number; y: number }[]; depth: number; scale: number }[] = [];
    for (const b of d.blocks) {
      const pts = boxCorners(b, d.origin).map((p) => project(p, cam.current, w, h));
      if (pts.some((p) => !p)) continue;
      const q = pts as NonNullable<(typeof pts)[number]>[];
      const c = project(boxCentre(b, d.origin), cam.current, w, h);
      // A frame is a backdrop: it sorts by its far edge, so it is always behind the boxes inside it (its centre can be nearer than a box at its side).
      const depth = b.type === 'frame' ? Math.max(...q.map((p) => p.depth)) : (c?.depth ?? q[0].depth);
      out.push({ b, q, depth, scale: q.reduce((s, p) => s + p.scale, 0) / 4 });
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
      const dep = depthOf(b);
      if (!dep || b.type === 'frame') continue;
      const top = project(boxCentre(b, d.origin), cam.current, w, h);
      const c = boxCentre(b, d.origin);
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

    for (const { b, q, scale } of items) {
      const dep = depthOf(b);
      const isFrame = b.type === 'frame';
      const tint = !isFrame && b.tint ? b.tint : b.type === 'note' && b.style === 'sticky' ? 'yellow' : null;
      const fill = isFrame ? null : tint ? col(`var(--n-${tint})`) : sheet;
      const text = tint ? col(`var(--n-${tint}-ink)`) : ink;
      const on = b.id === d.selected;
      const near = b.id === d.hover;
      // Boxes further away fade a little, so what is in front stands out.
      ctx.globalAlpha = isFrame ? 0.7 : Math.max(0.55, Math.min(1, 1 + dep / 2400));
      ctx.beginPath();
      q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.lineWidth = on ? 3 : near ? 2 : 1.2;
      ctx.strokeStyle = on ? accent : near ? ink : isFrame ? grey : rule;
      ctx.setLineDash(isFrame ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      // The words, kept inside the box's outline.
      const wpx = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
      const hpx = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
      if (wpx >= 38 && hpx >= 16) {
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
      if (dep && wpx >= 38) {
        ctx.globalAlpha = 1;
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = dep > 0 ? accent : grey;
        ctx.fillText(`${dep > 0 ? '+' : '−'}${Math.abs(dep)}`, q[1].x - 4, q[1].y - 4);
      }
    }
    ctx.globalAlpha = 1;
  }, [quads]);

  const schedule = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      draw();
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
      cam.current = { ...cam.current, dist: clampDist(cam.current.dist * Math.exp(e.deltaY * 0.0012)) };
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
    for (const b of d.blocks) pts.push(...boxCorners(b, d.origin));
    pts.push({ x: 0, y: 0, z: 0 });
    cam.current = frame(pts, { ...cam.current, yaw: START_CAMERA.yaw, pitch: START_CAMERA.pitch }, 2.8);
    schedule();
  }, [schedule]);
  useEffect(() => {
    if (!fitted.current && blocks.length) {
      fitted.current = true;
      fit();
    }
  }, [blocks.length, fit]);

  /* ---- changing things (each one goes through the page store, so undo and sync work as usual) ---- */
  const setDepthOf = (id: string, depth: number, merge = true) =>
    updateBlock(pageId, id, (b) => void applyDepth([b as never], [id], depth), { history: merge ? { key: `space-depth:${id}` } : 'none' });
  const spread = () => mutatePage(pageId, (p) => void fanOut(p.blocks as never));
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
    const id = addBlock(pageId, 'sticky', { x: o.x - 100 + n * 28, y: o.y - 100 + n * 28 }, { html: textToHtml(t), depth: chosen ? depthOf(chosen) : 0 });
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
    return quads(p.w, p.h).find((i) => pointInQuad(p.x, p.y, i.q))?.b ?? null;
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
    const b = e.shiftKey ? null : boxAt(e);
    if (b) {
      setSelected(b.id);
      if (isLayerable(b)) {
        const hit = onLayer(e, depthOf(b));
        const c = boxCentre(b, dataRef.current.origin);
        grab.current = { id: b.id, mode: e.altKey ? 'depth' : 'plane', moved: 0, startX: e.clientX, startY: e.clientY, startDepth: depthOf(b), offX: hit ? c.x - hit.x : 0, offY: hit ? c.y - hit.y : 0, began: false };
      }
      return;
    }
    orbit.current = { x: e.clientX, y: e.clientY, yaw: cam.current.yaw, pitch: cam.current.pitch, target: { ...cam.current.target }, shift: e.shiftKey, moved: 0 };
  };
  const move = (e: React.PointerEvent) => {
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
        const hit = onLayer(e, depthOf(b));
        if (!hit) return;
        const at = toPage(hit.x + g.offX, hit.y + g.offY, dataRef.current.origin);
        updateBlock(pageId, g.id, (x) => ((x.x = Math.round(at.x - x.w / 2)), (x.y = Math.round(at.y - blockHeight(x as Block) / 2))), { history: 'none' });
      }
      return;
    }
    const o = orbit.current;
    if (o) {
      const dx = e.clientX - o.x;
      const dy = e.clientY - o.y;
      o.moved = Math.max(o.moved, Math.hypot(dx, dy));
      if (o.shift) {
        const k = cam.current.dist / 700;
        const cy = Math.cos(cam.current.yaw);
        const sy = Math.sin(cam.current.yaw);
        cam.current = { ...cam.current, target: { x: o.target.x - dx * cy * k, y: o.target.y + dy * k, z: o.target.z + dx * sy * k } };
      } else cam.current = { ...cam.current, yaw: o.yaw - dx * 0.008, pitch: clampPitch(o.pitch + dy * 0.008) };
      schedule();
      return;
    }
    const b = boxAt(e);
    const id = b?.id ?? null;
    if (id !== hover) {
      setHover(id);
      canvas.current!.style.cursor = b ? (isLayerable(b) ? 'move' : 'pointer') : 'grab';
    }
  };
  const release = () => {
    const g = grab.current;
    grab.current = null;
    if (g?.began) {
      const p = useNotes.getState().pages[pageId];
      if (p) endGesture(pageId);
    }
    const o = orbit.current;
    orbit.current = null;
    if (o && o.moved < 4) setSelected(null);
  };

  useEffect(() => {
    const el = canvas.current as (HTMLCanvasElement & { __screen?: () => SpaceScreenInfo }) | null;
    if (!el) return;
    el.__screen = () => {
      const r = el.getBoundingClientRect();
      return {
        boxes: quads(r.width, r.height).map((i) => ({ id: i.b.id, x: r.left + (i.q[0].x + i.q[2].x) / 2, y: r.top + (i.q[0].y + i.q[2].y) / 2, w: Math.hypot(i.q[1].x - i.q[0].x, i.q[1].y - i.q[0].y), depth: depthOf(i.b) })),
        selected: dataRef.current.selected,
        camera: { dist: cam.current.dist, yaw: cam.current.yaw, pitch: cam.current.pitch },
      };
    };
  });

  if (!page) return null;
  const depth = chosen ? depthOf(chosen) : 0;
  const layerable = !!chosen && isLayerable(chosen);
  const anyDepth = blocks.some((b) => b.depth);

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
                    <span>Depth: {depth > 0 ? `${depth} nearer` : depth < 0 ? `${-depth} further` : 'on the page'}</span>
                    <input type="range" aria-label="Depth" min={DEPTH_MIN} max={DEPTH_MAX} step={10} value={depth} disabled={!layerable} onChange={(e) => setDepthOf(chosen.id, Number(e.target.value))} />
                  </label>
                  <div className="space-btns">
                    <button className="btn small" disabled={!layerable} onClick={() => setDepthOf(chosen.id, depth + DEPTH_STEP, false)}>Bring nearer</button>
                    <button className="btn small" disabled={!layerable} onClick={() => setDepthOf(chosen.id, depth - DEPTH_STEP, false)}>Push back</button>
                    <button className="btn small" disabled={!layerable || !depth} onClick={() => setDepthOf(chosen.id, 0, false)}>On the page</button>
                  </div>
                  <button className="btn small" onClick={() => edit(chosen.id)}>Edit on the page</button>
                  {!layerable && <p className="space-hint">{chosen.locked ? 'This box is locked.' : 'A frame stays on the page with what is inside it.'}</p>}
                </>
              ) : (
                <p className="space-hint">Click a box to select it. Drag it to move it on its layer, Alt+drag to bring it nearer or push it back.</p>
              )}
            </section>
            <section>
              <h3>This page</h3>
              <button className="btn small" onClick={spread} title="Spread the boxes through depth by how they are stacked, so boxes lying on top of each other come apart">Spread into layers</button>
              <button className="btn small" disabled={!anyDepth} onClick={flatten}>Put everything on the page</button>
              <button className="btn small" onClick={fit}>Fit</button>
            </section>
            <section>
              <h3>Why depth</h3>
              <p className="space-hint">Where something sits helps you find and remember it. Write and edit on the page itself, where text is easiest to read: use depth to arrange, not to type.</p>
            </section>
          </aside>
          <div className="tree3d-stage">
            <canvas
              ref={canvas}
              className="tree3d-canvas"
              tabIndex={0}
              role="img"
              aria-label="The boxes of this page in 3D: drag a box to move it, Alt+drag to change its depth, drag the empty space to turn the picture, scroll to zoom."
              onPointerDown={press}
              onPointerMove={move}
              onPointerUp={release}
              onPointerCancel={release}
              onPointerLeave={() => setHover(null)}
              onDoubleClick={(e) => {
                const b = boxAt(e);
                if (b) edit(b.id);
                else fit();
              }}
              onKeyDown={(e) => {
                const c = cam.current;
                if (e.key === ']' && chosen && isLayerable(chosen)) setDepthOf(chosen.id, depthOf(chosen) + DEPTH_STEP, false);
                else if (e.key === '[' && chosen && isLayerable(chosen)) setDepthOf(chosen.id, depthOf(chosen) - DEPTH_STEP, false);
                else if (e.key === 'Enter' && chosen) return edit(chosen.id);
                else if (e.key === 'ArrowLeft') cam.current = { ...c, yaw: c.yaw + 0.12 };
                else if (e.key === 'ArrowRight') cam.current = { ...c, yaw: c.yaw - 0.12 };
                else if (e.key === 'ArrowUp') cam.current = { ...c, pitch: clampPitch(c.pitch - 0.1) };
                else if (e.key === 'ArrowDown') cam.current = { ...c, pitch: clampPitch(c.pitch + 0.1) };
                else if (e.key === '+' || e.key === '=') cam.current = { ...c, dist: clampDist(c.dist * 0.85) };
                else if (e.key === '-') cam.current = { ...c, dist: clampDist(c.dist / 0.85) };
                else if (e.key === '0') return fit();
                else return;
                e.preventDefault();
                schedule();
              }}
            />
            {blocks.length === 0 && <p className="graph-empty">This page has no boxes yet. Write a note above and it will appear here.</p>}
            <div className="tree3d-help" aria-hidden="true">Drag a box to move it · Alt+drag, [ and ] change its depth · Drag the space to turn · Scroll to zoom · Shift+drag to move · Double-click a box to edit it</div>
          </div>
        </div>
      </div>
    </div>
  );
}
