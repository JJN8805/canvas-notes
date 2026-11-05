import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type React from 'react';
import type { Block } from '../../types';
import {
  addArrow,
  addBlock,
  beginGesture,
  bringToFront,
  deleteBlocks,
  duplicateBlocks,
  endGesture,
  mutatePage,
  useNotes,
} from '../../store/notes';
import { addMediaFiles } from '../../store/media';
import {
  canvasApi,
  editorRegistry,
  freshText,
  setSelectMode,
  setSelected,
  setSelectedArrow,
  useCanvas,
  type CanvasView,
  type Point,
} from '../../store/canvas';
import { useDraw } from '../../store/draw';
import { dragsStickyBody } from '../../lib/colors';
import { liveDrawing, svgSrc } from '../../lib/drawing';
import {
  blockHeight,
  clamp,
  isFixedHeight,
  snap,
} from '../../lib/util';
import { inkClipPath } from '../../lib/sheet';
import { BlockFrame } from './BlockFrame';
import { FrameChrome } from './FrameChrome';
import { usePrefs } from '../../store/prefs';
import { boundsOf, guideLines, nearestShift, type Guide, type Rect as BoxRect } from '../../lib/guides';
import { containingFrame, frameDescendants, hiddenBlockIds, paintOrder } from '../../lib/frames';
import { sidePoint, type Side } from '../../lib/arrows';
import { ArrowLayer, type ConnectingLine } from './ArrowLayer';
import { pinBlocks } from '../../widgets';
import { useWidgetsAvailable } from '../../widgets/useWidgetsAvailable';
import { useViewportZoom } from './canvas/useViewportZoom';
import { useEmptyBoxCleanup } from './canvas/useEmptyBoxCleanup';
import { useCanvasKeyboard } from './canvas/useCanvasKeyboard';
import { CanvasCtx, type CanvasCtxValue, type ResizeDir } from './context';
import {
  contentBounds,
  EDGE_PX,
  fitView,
  growOrigin,
  initialOrigin,
  scrollShift,
  toCanvas,
} from '../../lib/viewport';

const EMPTY: Block[] = [];
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const MARGIN = 640; // empty canvas kept beyond the furthest block
const SHEET_PAD = 48; // desk shown around a finite page's sheet
const SNAP_PX = 6; // screen pixels within which edges snap together

type Rect = { x: number; y: number; w: number; h: number };

export function Canvas({ pageId }: { pageId: string }) {
  const blocks = useNotes((s) => s.pages[pageId]?.blocks ?? EMPTY);
  const selected = useCanvas((s) => s.selected);
  const zoom = useCanvas((s) => s.zoom);
  const selectMode = useCanvas((s) => s.selectMode);

  const viewportRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const drawing = useNotes((s) => s.pages[pageId]?.drawing ?? null);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const sheet = useNotes((s) => s.pages[pageId]?.sheet ?? null);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const wasFinite = useRef(sheet !== null);
  const drawMode = useDraw((s) => s.open);
  const pendingScroll = useRef<Point | null>(null);
  /** The canvas coordinate at scroll position 0 (see lib/viewport.ts), and the furthest right/bottom the page has been opened up to. */
  const origin = useRef<Point | null>(null);
  const reach = useRef<Point>({ x: 0, y: 0 });
  const spaceDown = useRef(false);
  const cascade = useRef(0);

  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [panMode, setPanMode] = useState<'off' | 'ready' | 'panning'>('off');
  const [dropping, setDropping] = useState(false);
  const [guides, setGuidesState] = useState<Guide[]>([]);
  const [connecting, setConnecting] = useState<ConnectingLine | null>(null);
  const guidesKey = useRef('');
  const setGuides = useCallback((g: Guide[]) => {
    const key = JSON.stringify(g);
    if (key === guidesKey.current) return;
    guidesKey.current = key;
    setGuidesState(g);
  }, []);

  /* ---------- geometry ---------- */

  const worldPoint = useCallback((clientX: number, clientY: number): Point => {
    const v = viewportRef.current!;
    const r = v.getBoundingClientRect();
    const z = useCanvas.getState().zoom;
    const o = origin.current ?? { x: 0, y: 0 };
    return { x: toCanvas(clientX - r.left, v.scrollLeft, o.x, z), y: toCanvas(clientY - r.top, v.scrollTop, o.y, z) };
  }, []);

  /** The canvas coordinate at the top-left of the view. Unlike scrollLeft/scrollTop it doesn't change when the origin moves. */
  const viewCorner = useCallback((): Point => {
    const v = viewportRef.current!;
    const z = useCanvas.getState().zoom;
    const o = origin.current ?? { x: 0, y: 0 };
    return { x: v.scrollLeft / z + o.x, y: v.scrollTop / z + o.y };
  }, []);

  const heightOf = (b: Block) => heights.current.get(b.id) ?? blockHeight(b);

  const updateExtent = useCallback(() => {
    const v = viewportRef.current, world = worldRef.current, sizer = sizerRef.current;
    if (!v || !world || !sizer) return;
    const z = useCanvas.getState().zoom;
    const boxes: Rect[] = blocksRef.current.map((b) => ({ x: b.x, y: b.y, w: b.w, h: heights.current.get(b.id) ?? blockHeight(b) }));
    const ink = liveDrawing(drawingRef.current);
    if (ink) boxes.push(ink);
    const content = contentBounds(boxes);

    const first = origin.current === null;
    const sh = sheetRef.current;
    const r = reach.current;
    let o: Point, old: Point, left: number, top: number, W: number, H: number;
    if (sh) {
      // A finite page: the scrollable area is the sheet plus a margin of desk, centred when the view is bigger than the sheet.
      const vw = v.clientWidth / z, vh = v.clientHeight / z;
      old = origin.current ?? { x: 0, y: 0 };
      o = { x: Math.floor(sh.x - Math.max(SHEET_PAD, (vw - sh.w) / 2)), y: Math.floor(sh.y - Math.max(SHEET_PAD, (vh - sh.h) / 2)) };
      if (first) old = o;
      origin.current = o;
      left = first ? 0 : v.scrollLeft;
      top = first ? 0 : v.scrollTop;
      W = Math.max(vw, sh.x + sh.w + SHEET_PAD - o.x);
      H = Math.max(vh, sh.y + sh.h + SHEET_PAD - o.y);
      r.x = o.x + W;
      r.y = o.y + H;
    } else {
      // The page has no edges: the scrollable area always reaches well past the content and the view, in every direction.
      old = origin.current ?? initialOrigin(content, z);
      o = first ? old : { x: growOrigin(old.x, content?.minX ?? null, v.scrollLeft, z), y: growOrigin(old.y, content?.minY ?? null, v.scrollTop, z) };
      origin.current = o;
      left = first ? -o.x * z : v.scrollLeft;
      top = first ? -o.y * z : v.scrollTop;
      r.x = Math.max(r.x, (content?.maxX ?? 0) + MARGIN, toCanvas(v.clientWidth, left, o.x, z) + EDGE_PX / z);
      r.y = Math.max(r.y, (content?.maxY ?? 0) + MARGIN, toCanvas(v.clientHeight, top, o.y, z) + EDGE_PX / z);
      W = Math.max(v.clientWidth / z, r.x - o.x);
      H = Math.max(v.clientHeight / z, r.y - o.y);
    }
    // Boxes sit at their real coordinates inside the world; the transform slides the origin to the scroll area's corner.
    world.style.width = Math.max(1, r.x) + 'px';
    world.style.height = Math.max(1, r.y) + 'px';
    world.style.transform = `translate(${-o.x * z}px, ${-o.y * z}px) scale(${z})`;
    sizer.style.width = W * z + 'px';
    sizer.style.height = H * z + 'px';
    // The dotted background lives on the sizer (the world can't cover negative coordinates) and is kept lined up with the canvas grid.
    if (sh) {
      sizer.style.backgroundImage = 'none'; // a finite page's dots are on its sheet
    } else {
      sizer.style.backgroundImage = `radial-gradient(var(--dot) ${1.1 * z}px, transparent ${1.4 * z}px)`;
      sizer.style.backgroundSize = `${24 * z}px ${24 * z}px`;
      sizer.style.backgroundPosition = `${(4 - o.x) * z}px ${(4 - o.y) * z}px`;
    }

    if (first) {
      v.scrollLeft = left;
      v.scrollTop = top;
    } else {
      const sx = scrollShift(old.x, o.x, z), sy = scrollShift(old.y, o.y, z);
      if (sx || sy) {
        v.scrollLeft += sx;
        v.scrollTop += sy;
        if (pendingScroll.current) pendingScroll.current = { x: pendingScroll.current.x + sx, y: pendingScroll.current.y + sy };
      }
    }
  }, []);

  useLayoutEffect(() => {
    // Switching between finite and infinite starts the scroll area afresh (growing or resizing a sheet does not).
    if (wasFinite.current !== (sheet !== null)) {
      wasFinite.current = sheet !== null;
      origin.current = null;
      reach.current = { x: 0, y: 0 };
    }
    updateExtent();
    const v = viewportRef.current;
    if (v && pendingScroll.current) {
      v.scrollLeft = pendingScroll.current.x;
      v.scrollTop = pendingScroll.current.y;
      pendingScroll.current = null;
    }
  }, [blocks, drawing, zoom, sheet, updateExtent]);

  useEffect(() => {
    const ro = new ResizeObserver(() => updateExtent());
    ro.observe(viewportRef.current!);
    // Scrolling towards any edge opens up more canvas, so the page never runs out.
    const v = viewportRef.current!;
    v.addEventListener('scroll', updateExtent, { passive: true });
    return () => {
      ro.disconnect();
      v.removeEventListener('scroll', updateExtent);
    };
  }, [updateExtent]);

  // Leave select mode once the last selected box is tapped off.
  const prevCount = useRef(0);
  useEffect(() => {
    if (selectMode && prevCount.current > 0 && selected.length === 0) setSelectMode(false);
    prevCount.current = selected.length;
  }, [selected, selectMode]);

  // Drop selection entries whose blocks disappeared (undo, delete in another window).
  useEffect(() => {
    const ids = new Set(blocks.map((b) => b.id));
    const sel = useCanvas.getState().selected;
    if (sel.some((id) => !ids.has(id))) setSelected(sel.filter((id) => ids.has(id)));
  }, [blocks]);

  const zoomTo = useCallback((next: number, anchor?: Point) => {
    const v = viewportRef.current;
    if (!v) return;
    const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
    const old = useCanvas.getState().zoom;
    if (z === old) return;
    const ax = anchor?.x ?? v.clientWidth / 2;
    const ay = anchor?.y ?? v.clientHeight / 2;
    const wx = (v.scrollLeft + ax) / old;
    const wy = (v.scrollTop + ay) / old;
    pendingScroll.current = { x: wx * z - ax, y: wy * z - ay };
    useCanvas.setState({ zoom: z });
  }, []);

  const visibleSpot = useCallback((w: number, h: number): Point => {
    const v = viewportRef.current!;
    const z = useCanvas.getState().zoom;
    cascade.current = (cascade.current + 1) % 6;
    const off = cascade.current * 24;
    const c = viewCorner();
    return {
      x: snap(c.x + v.clientWidth / 2 / z - w / 2 + off),
      y: snap(c.y + v.clientHeight / 2.5 / z - h / 2 + off),
    };
  }, [viewCorner]);

  /** Where the pointer last was (screen coordinates), so "S" can drop a sticky under it. */
  const pointer = useRef<Point | null>(null);

  const focusBlock = useCallback((id: string) => {
    const ed = editorRegistry.get(id);
    if (ed) {
      ed.commands.focus('end');
      return;
    }
    const el = worldRef.current?.querySelector<HTMLElement>(`[data-id="${id}"] textarea, [data-id="${id}"] [contenteditable="true"]`);
    el?.focus();
  }, []);

  const getView = useCallback((): CanvasView => {
    const v = viewportRef.current;
    const z = useCanvas.getState().zoom;
    const o = origin.current ?? { x: 0, y: 0 };
    // `left`/`top` are the canvas coordinate at the view's top-left edge, in screen pixels (so they can be negative).
    return { zoom: z, left: (v?.scrollLeft ?? 0) + o.x * z, top: (v?.scrollTop ?? 0) + o.y * z };
  }, []);

  const setView = useCallback((next: CanvasView) => {
    const v = viewportRef.current;
    if (!v) return;
    const z = clamp(next.zoom, MIN_ZOOM, MAX_ZOOM);
    const o = origin.current ?? { x: 0, y: 0 };
    const at = { x: next.left - o.x * z, y: next.top - o.y * z };
    if (z === useCanvas.getState().zoom) {
      v.scrollLeft = at.x;
      v.scrollTop = at.y;
    } else {
      pendingScroll.current = at;
      useCanvas.setState({ zoom: z });
    }
  }, []);

  /** Zooms and scrolls so everything on the page is in view (or goes back to the start of an empty page). */
  const fitContent = useCallback(() => {
    const v = viewportRef.current;
    if (!v) return;
    const boxes: Rect[] = blocksRef.current.map((b) => ({ x: b.x, y: b.y, w: b.w, h: heights.current.get(b.id) ?? blockHeight(b) }));
    const ink = liveDrawing(drawingRef.current);
    if (ink) boxes.push(ink);
    const sh = sheetRef.current;
    const content = sh
      ? { minX: sh.x, minY: sh.y, maxX: sh.x + sh.w, maxY: sh.y + sh.h }
      : contentBounds(boxes) ?? { minX: 0, minY: 0, maxX: v.clientWidth, maxY: v.clientHeight };
    const f = fitView(content, v.clientWidth, v.clientHeight, MIN_ZOOM);
    setView({ zoom: f.zoom, left: f.x * f.zoom, top: f.y * f.zoom });
  }, [setView]);

  useEffect(() => {
    canvasApi.current = { worldPoint, visibleSpot, focusBlock, zoomTo, getView, setView };
    return () => {
      canvasApi.current = null;
    };
  }, [worldPoint, visibleSpot, focusBlock, zoomTo, getView, setView]);

  const blurInside = () => {
    const a = document.activeElement as HTMLElement | null;
    if (a && worldRef.current?.contains(a)) a.blur();
  };

  /* ---------- block gestures ---------- */

  const startMove = useCallback(
    (e: React.PointerEvent, id: string, opts: { onTap?: () => void } = {}) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      let sel = useCanvas.getState().selected;
      if (!sel.includes(id)) {
        sel = e.shiftKey ? [...sel, id] : [id];
        setSelected(sel);
      }
      blurInside();

      const page = useNotes.getState().pages[pageId];
      if (!page) return;
      // Dragging a frame also drags everything nested inside it.
      const dragIds = new Set(sel);
      for (const sid of sel) {
        const b = page.blocks.find((x) => x.id === sid);
        if (b?.type === 'frame') for (const d of frameDescendants(page.blocks, sid)) dragIds.add(d);
      }
      bringToFront(pageId, [...dragIds]);

      const starts = new Map(page.blocks.filter((b) => dragIds.has(b.id)).map((b) => [b.id, { x: b.x, y: b.y }]));
      const anchor = starts.get(id)!;
      const rectOf = (b: Block): BoxRect => ({ x: b.x, y: b.y, w: b.w, h: heights.current.get(b.id) ?? blockHeight(b) });
      const group = boundsOf(page.blocks.filter((b) => starts.has(b.id)).map(rectOf));
      const others = page.blocks.filter((b) => !starts.has(b.id)).map(rectOf);
      beginGesture(pageId);

      const v = viewportRef.current!;
      const s0 = { x: e.clientX, y: e.clientY, c: viewCorner() };
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      const frame = worldRef.current?.querySelector(`[data-id="${id}"]`);
      frame?.classList.add('dragging');

      let last = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey };
      let raf = 0;
      let edgeRaf = 0;
      let moved = false;

      const apply = () => {
        raf = 0;
        const z = useCanvas.getState().zoom;
        // Measured against the canvas coordinate at the view's corner, so the page opening up further left or up mid-drag doesn't move the box.
        const c = viewCorner();
        let dx = (last.clientX - s0.x) / z + (c.x - s0.c.x);
        let dy = (last.clientY - s0.y) / z + (c.y - s0.c.y);
        let lines: Guide[] = [];
        if (!last.altKey && usePrefs.getState().snap) {
          // Line up with other boxes when close; otherwise snap to the 8 px grid.
          const moved = { ...group, x: group.x + dx, y: group.y + dy };
          const sx = nearestShift(moved, others, SNAP_PX / z, 'x');
          const sy = nearestShift(moved, others, SNAP_PX / z, 'y');
          dx = sx !== null ? dx + sx : snap(anchor.x + dx) - anchor.x;
          dy = sy !== null ? dy + sy : snap(anchor.y + dy) - anchor.y;
          lines = guideLines({ ...group, x: group.x + dx, y: group.y + dy }, others);
        }
        setGuides(lines);
        mutatePage(
          pageId,
          (p) => {
            for (const b of p.blocks) {
              const st = starts.get(b.id);
              if (st) {
                b.x = st.x + dx;
                b.y = st.y + dy;
              }
            }
          },
          { history: 'none', touch: false },
        );
      };
      const schedule = () => {
        if (!raf) raf = requestAnimationFrame(apply);
      };
      // Scroll when dragging near the viewport edge.
      const touch = e.pointerType === 'touch';
      const edge = () => {
        const r = v.getBoundingClientRect();
        const m = touch ? 20 : 40;
        let sx = 0, sy = 0;
        if (last.clientX > r.right - m) sx = 14;
        else if (last.clientX < r.left + m) sx = -14;
        if (last.clientY > r.bottom - m) sy = 14;
        else if (last.clientY < r.top + m) sy = -14;
        if (sx || sy) {
          v.scrollLeft += sx;
          v.scrollTop += sy;
          schedule();
          edgeRaf = requestAnimationFrame(edge);
        } else edgeRaf = 0;
      };
      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - s0.x, ev.clientY - s0.y) < 5) return;
        moved = true;
        last = ev;
        schedule();
        if (!edgeRaf) edgeRaf = requestAnimationFrame(edge);
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        cancelAnimationFrame(edgeRaf);
        if (raf) {
          cancelAnimationFrame(raf);
          apply();
        }
        frame?.classList.remove('dragging');
        setGuides([]);
        if (moved) {
          // Re-test which frame (if any) each originally-dragged item now sits inside,
          // so dropping a box into/out of a frame updates its membership. A moved frame
          // can't be dropped into itself or one of its own descendants.
          const latest = useNotes.getState().pages[pageId];
          if (latest) {
            const updates = new Map<string, string | null>();
            for (const sid of sel) {
              const b = latest.blocks.find((x) => x.id === sid);
              if (!b) continue;
              const rect: BoxRect = { x: b.x, y: b.y, w: b.w, h: heights.current.get(b.id) ?? blockHeight(b) };
              const dest = containingFrame(latest.blocks, rect, dragIds);
              const next = dest?.id ?? null;
              if (next !== (b.frameId ?? null)) updates.set(sid, next);
            }
            if (updates.size) {
              mutatePage(
                pageId,
                (p) => {
                  for (const b of p.blocks) if (updates.has(b.id)) b.frameId = updates.get(b.id) ?? null;
                },
                { history: 'none', touch: false },
              );
            }
          }
        }
        endGesture(pageId);
        if (!moved) opts.onTap?.();
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    },
    [pageId, setGuides, viewCorner],
  );

  const startResize = useCallback(
    (e: React.PointerEvent, id: string, dir: ResizeDir = 'se') => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const b = useNotes.getState().pages[pageId]?.blocks.find((x) => x.id === id);
      if (!b) return;
      const el = worldRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`);
      const startH = isFixedHeight(b) ? b.h : Math.max(b.h, el?.offsetHeight ?? b.h);
      const aspect = b.type === 'image' && b.aspect ? b.aspect : b.w / startH;
      const s0 = { x: e.clientX, y: e.clientY, w: b.w, h: startH };
      const others: BoxRect[] = (useNotes.getState().pages[pageId]?.blocks ?? [])
        .filter((o) => o.id !== id)
        .map((o) => ({ x: o.x, y: o.y, w: o.w, h: heights.current.get(o.id) ?? blockHeight(o) }));
      beginGesture(pageId);
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      let raf = 0;
      let last: PointerEvent | null = null;
      const apply = () => {
        raf = 0;
        if (!last) return;
        const z = useCanvas.getState().zoom;
        const dx = (last.clientX - s0.x) / z;
        const dy = (last.clientY - s0.y) / z;
        const east = dir.includes('e');
        const west = dir.includes('w');
        const south = dir.includes('s');
        const north = dir.includes('n');
        let w = east ? Math.max(64, s0.w + dx) : west ? Math.max(64, s0.w - dx) : s0.w;
        let h = south ? Math.max(32, s0.h + dy) : north ? Math.max(32, s0.h - dy) : s0.h;
        // Dragging a west/north edge moves the box so the opposite edge stays put.
        const right = b.x + s0.w;
        const bottom = b.y + s0.h;
        const keepRatio = b.type === 'image' && dir.length === 2 && !last.shiftKey;
        let lines: Guide[] = [];
        if (!last.altKey && usePrefs.getState().snap) {
          const x0 = west ? right - w : b.x;
          const y0 = north ? bottom - h : b.y;
          if (east) {
            const sx = nearestShift({ x: x0, y: y0, w, h }, others, SNAP_PX / z, 'x', ['end']);
            w = sx !== null ? w + sx : snap(w);
          } else if (west) {
            const sx = nearestShift({ x: x0, y: y0, w, h }, others, SNAP_PX / z, 'x', ['start']);
            w = sx !== null ? w - sx : snap(w);
          }
          if (!keepRatio && south) {
            const sy = nearestShift({ x: x0, y: y0, w, h }, others, SNAP_PX / z, 'y', ['end']);
            h = sy !== null ? h + sy : snap(h);
          } else if (!keepRatio && north) {
            const sy = nearestShift({ x: x0, y: y0, w, h }, others, SNAP_PX / z, 'y', ['start']);
            h = sy !== null ? h - sy : snap(h);
          }
        }
        if (keepRatio) h = Math.round(w / aspect);
        const nx = west ? right - w : b.x;
        const ny = north ? bottom - h : b.y;
        if (!last.altKey) lines = guideLines({ x: nx, y: ny, w, h }, others, west ? ['start'] : east ? ['end'] : [], keepRatio ? [] : north ? ['start'] : south ? ['end'] : []);
        setGuides(lines);
        mutatePage(
          pageId,
          (p) => {
            const t = p.blocks.find((x) => x.id === id);
            if (t) {
              t.x = nx;
              t.y = ny;
              t.w = w;
              t.h = h;
            }
          },
          { history: 'none', touch: false },
        );
      };
      const move = (ev: PointerEvent) => {
        last = ev;
        if (!raf) raf = requestAnimationFrame(apply);
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        if (raf) {
          cancelAnimationFrame(raf);
          apply();
        }
        setGuides([]);
        endGesture(pageId);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    },
    [pageId, setGuides],
  );

  const startConnect = useCallback(
    (e: React.PointerEvent, blockId: string, side: Side) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const b = useNotes.getState().pages[pageId]?.blocks.find((x) => x.id === blockId);
      if (!b) return;
      const rect: BoxRect = { x: b.x, y: b.y, w: b.w, h: heightOf(b) };
      const start = sidePoint(rect, side);
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      let hoverId: string | null = null;
      let hoverEl: HTMLElement | null = null;
      let last = { clientX: e.clientX, clientY: e.clientY };
      let raf = 0;

      const apply = () => {
        raf = 0;
        const p = worldPoint(last.clientX, last.clientY);
        setConnecting({ x1: start.x, y1: start.y, x2: p.x, y2: p.y });
        const el = document.elementFromPoint(last.clientX, last.clientY)?.closest<HTMLElement>('.block');
        const id = el?.dataset.id && el.dataset.id !== blockId ? el.dataset.id : null;
        if (id !== hoverId) {
          hoverEl?.classList.remove('connect-target');
          hoverId = id;
          hoverEl = id ? el! : null;
          hoverEl?.classList.add('connect-target');
        }
      };
      const move = (ev: PointerEvent) => {
        last = ev;
        if (!raf) raf = requestAnimationFrame(apply);
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        if (raf) cancelAnimationFrame(raf);
        hoverEl?.classList.remove('connect-target');
        setConnecting(null);
        if (hoverId) {
          const id = addArrow(pageId, blockId, hoverId);
          if (id) setSelectedArrow(id);
        }
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    },
    [pageId, worldPoint],
  );

  const longPress = useRef<(() => void) | null>(null);
  const cancelLongPress = () => {
    longPress.current?.();
    longPress.current = null;
  };

  const pointerDownBlock = useCallback(
    (e: React.PointerEvent, id: string) => {
      // Right/middle clicks and Space-drag panning pass over boxes without selecting, raising or editing them.
      if (e.button !== 0 || spaceDown.current) return;
      const sel = useCanvas.getState().selected;
      if (e.pointerType === 'touch') {
        if (useCanvas.getState().selectMode) {
          // Selecting: a tap adds or removes the box, a drag moves every selected box.
          const was = sel.includes(id);
          if (!was) setSelected([...sel, id]);
          startMove(e, id, was ? { onTap: () => setSelected(useCanvas.getState().selected.filter((x) => x !== id)) } : {});
          return;
        }
        // Long-press starts selecting.
        cancelLongPress();
        const x0 = e.clientX, y0 = e.clientY;
        const onMove = (ev: PointerEvent) => {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) cancelLongPress();
        };
        const timer = window.setTimeout(() => {
          cancelLongPress();
          blurInside();
          window.getSelection()?.removeAllRanges();
          setSelectMode(true);
          setSelected([id]);
          navigator.vibrate?.(12);
        }, 420);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', cancelLongPress);
        window.addEventListener('pointercancel', cancelLongPress);
        longPress.current = () => {
          clearTimeout(timer);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', cancelLongPress);
          window.removeEventListener('pointercancel', cancelLongPress);
        };
      }
      // A sticky is dragged by its text like a real note; double-click (or Enter) to type in it.
      const target = e.target as HTMLElement;
      const text = target.closest('.text-editor');
      if (
        dragsStickyBody({
          type: useNotes.getState().pages[pageId]?.blocks.find((b) => b.id === id)?.type ?? '',
          pointerType: e.pointerType,
          shiftKey: e.shiftKey,
          editing: !!text?.contains(document.activeElement),
          onText: !!text,
        })
      ) {
        startMove(e, id);
        return;
      }
      if (e.shiftKey) {
        // Shift-click toggles a block in the selection without starting to edit it.
        if ((e.target as HTMLElement).closest('.grip, .grab')) return;
        e.preventDefault();
        setSelected(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
        return;
      }
      if ((e.target as HTMLElement).closest('.grip, .grab, .resize, .bar button, .dot, .ci-grip')) return;
      if (!(sel.length === 1 && sel[0] === id)) setSelected([id]);
      bringToFront(pageId, [id]);
    },
    [pageId, startMove],
  );

  const reportHeight = useCallback(
    (id: string, h: number) => {
      heights.current.set(id, h);
      updateExtent();
      const b = useNotes.getState().pages[pageId]?.blocks.find((x) => x.id === id);
      if (b && !isFixedHeight(b) && Math.abs((b.ah ?? 0) - h) > 2) {
        mutatePage(
          pageId,
          (p) => {
            const t = p.blocks.find((x) => x.id === id);
            if (t) t.ah = Math.round(h);
          },
          { history: 'none', touch: false },
        );
      }
    },
    [pageId, updateExtent],
  );

  const ctx = useMemo<CanvasCtxValue>(
    () => ({ pageId, startMove, startResize, startConnect, pointerDownBlock, reportHeight }),
    [pageId, startMove, startResize, startConnect, pointerDownBlock, reportHeight],
  );

  /* ---------- empty-canvas gestures: marquee, pan ---------- */

  const onViewportPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    const onEmpty = t === worldRef.current || t === sizerRef.current || t === viewportRef.current;
    const v = viewportRef.current!;

    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      // Pan with the middle button or Space + drag.
      e.preventDefault();
      const s0 = { x: e.clientX, y: e.clientY, sl: v.scrollLeft, st: v.scrollTop };
      v.setPointerCapture(e.pointerId);
      setPanMode('panning');
      const move = (ev: PointerEvent) => {
        v.scrollLeft = s0.sl - (ev.clientX - s0.x);
        v.scrollTop = s0.st - (ev.clientY - s0.y);
      };
      const up = () => {
        v.removeEventListener('pointermove', move);
        v.removeEventListener('pointerup', up);
        v.removeEventListener('pointercancel', up);
        setPanMode(spaceDown.current ? 'ready' : 'off');
      };
      v.addEventListener('pointermove', move);
      v.addEventListener('pointerup', up);
      v.addEventListener('pointercancel', up);
      return;
    }
    if (!onEmpty || e.button !== 0) return;
    blurInside();
    if (e.pointerType === 'touch') {
      // Let touch scroll the canvas natively; a tap just clears the selection.
      setSelectMode(false);
      return;
    }

    e.preventDefault();
    const base = e.shiftKey ? useCanvas.getState().selected : [];
    if (!e.shiftKey) setSelected([]);
    const p0 = worldPoint(e.clientX, e.clientY);
    let started = false;
    v.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = worldPoint(ev.clientX, ev.clientY);
      const r: Rect = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      if (!started && r.w < 4 && r.h < 4) return;
      started = true;
      setMarquee(r);
      const hidden = hiddenBlockIds(blocksRef.current);
      const hits = blocksRef.current
        .filter((b) => !hidden.has(b.id) && b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + heightOf(b) > r.y)
        .map((b) => b.id);
      setSelected([...new Set([...base, ...hits])]);
    };
    const up = () => {
      v.removeEventListener('pointermove', move);
      v.removeEventListener('pointerup', up);
      v.removeEventListener('pointercancel', up);
      setMarquee(null);
    };
    v.addEventListener('pointermove', move);
    v.addEventListener('pointerup', up);
    v.addEventListener('pointercancel', up);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // The marquee captures the pointer on the viewport, so the double-click can arrive there too.
    const t = e.target;
    if (t !== worldRef.current && t !== sizerRef.current && t !== viewportRef.current) return;
    if (spaceDown.current) return;
    const p = worldPoint(e.clientX, e.clientY);
    // Render the new box synchronously so typing goes straight into it.
    let id = '';
    flushSync(() => {
      id = addBlock(pageId, 'text', { x: snap(p.x - 8), y: snap(p.y - 16) });
      freshText.add(id);
      setSelected([id]);
    });
    focusBlock(id);
  };

  useViewportZoom(viewportRef, zoomTo);
  useEmptyBoxCleanup(pageId, selected);
  useCanvasKeyboard({ pageId, viewportRef, worldRef, blocksRef, pointer, spaceDown, setPanMode, focusBlock, visibleSpot, zoomTo, worldPoint, fitContent });

  /* ---------- file drop ---------- */

  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  /* ---------- render ---------- */

  const canPin = useWidgetsAvailable();
  const selSet = useMemo(() => new Set(selected), [selected]);
  const single = selected.length === 1;
  const hidden = useMemo(() => hiddenBlockIds(blocks), [blocks]);
  const ordered = useMemo(() => paintOrder(blocks).filter((b) => !hidden.has(b.id)), [blocks, hidden]);
  const visibleBlocks = useMemo(() => blocks.filter((b) => !hidden.has(b.id)), [blocks, hidden]);

  return (
    <CanvasCtx.Provider value={ctx}>
      <div
        ref={viewportRef}
        className={`viewport pan-${panMode}${selectMode ? ' select-mode' : ''}`}
        onContextMenu={(e) => {
          // A long-press on a phone shouldn't open the system menu while selecting.
          if (useCanvas.getState().selectMode || longPress.current) e.preventDefault();
        }}
        tabIndex={-1}
        onPointerDown={onViewportPointerDown}
        onDoubleClick={onDoubleClick}
        onDragEnter={(e) => {
          if (!hasFiles(e)) return;
          dragDepth.current++;
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!hasFiles(e)) return;
          if (--dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDropping(false);
          }
        }}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDropping(false);
          const p = worldPoint(e.clientX, e.clientY);
          void addMediaFiles(pageId, Array.from(e.dataTransfer.files), { x: snap(p.x - 40), y: snap(p.y - 40) }).then(
            (ids) => ids.length && setSelected(ids),
          );
        }}
      >
        <div ref={sizerRef} className="sizer">
          <div ref={worldRef} className="world">
            {sheet && (
              <div
                className="sheet"
                aria-hidden="true"
                style={{ left: sheet.x, top: sheet.y, width: sheet.w, height: sheet.h, backgroundPosition: `${4 - sheet.x}px ${4 - sheet.y}px` }}
              />
            )}
            {ordered.map((b) =>
              b.type === 'frame' ? (
                <FrameChrome key={b.id} block={b} selected={selSet.has(b.id)} single={single && selSet.has(b.id)} />
              ) : (
                <BlockFrame key={b.id} block={b} selected={selSet.has(b.id)} single={single && selSet.has(b.id)} />
              ),
            )}
            {!drawMode && liveDrawing(drawing) && (
              <img
                className="ink"
                alt=""
                draggable={false}
                src={svgSrc(drawing!.preview)}
                style={{ left: drawing!.x, top: drawing!.y, width: drawing!.w, height: drawing!.h, clipPath: sheet ? inkClipPath(drawing!, sheet) : undefined }}
              />
            )}
            <ArrowLayer pageId={pageId} blocks={visibleBlocks} heights={heights} connecting={connecting} />
            {guides.map((g, i) =>
              g.axis === 'x' ? (
                <div key={i} className="guide" style={{ left: g.pos, top: g.from, height: g.to - g.from, borderLeftWidth: 1 / zoom }} />
              ) : (
                <div key={i} className="guide" style={{ top: g.pos, left: g.from, width: g.to - g.from, borderTopWidth: 1 / zoom }} />
              ),
            )}
            {marquee && (
              <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
            )}
          </div>
        </div>
      </div>
      {dropping && <div className="drop-hint">Drop images to place them here</div>}
      {(selected.length > 1 || selectMode) && (
        <div className="multi-bar" role="toolbar" aria-label="Selected boxes">
          <span>
            {selected.length} selected
            {selectMode && selected.length < 2 && <span className="multi-hint">Tap boxes to add them</span>}
          </span>
          <button className="btn" disabled={!selected.length} onClick={() => setSelected(duplicateBlocks(pageId, selected))}>
            Duplicate
          </button>
          {canPin && (
            <button className="btn" disabled={!selected.length} onClick={() => void pinBlocks(pageId, blocks.filter((b) => selSet.has(b.id)))}>
              Pin to desktop
            </button>
          )}
          <button
            className="btn"
            disabled={!selected.length}
            onClick={() => {
              deleteBlocks(pageId, selected);
              setSelected([]);
            }}
          >
            Delete
          </button>
          {selectMode && (
            <button className="btn primary" onClick={() => setSelectMode(false)}>
              Done
            </button>
          )}
        </div>
      )}
    </CanvasCtx.Provider>
  );
}
