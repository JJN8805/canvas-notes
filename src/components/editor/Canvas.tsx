import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type React from 'react';
import type { Block } from '../../types';
import {
  addArrow,
  addBlock,
  beginGesture,
  bringToFront,
  deleteArrows,
  deleteBlocks,
  duplicateBlocks,
  endGesture,
  mutatePage,
  redo,
  undo,
  useNotes,
} from '../../store/notes';
import { addImages, imageFiles } from '../../store/images';
import { canvasApi, editorRegistry, setSelectMode, setSelected, setSelectedArrow, useCanvas, type CanvasView, type Point } from '../../store/canvas';
import { useUi } from '../../store/ui';
import { useDraw } from '../../store/draw';
import { dragsStickyBody, isStickyKey, STICKY_SIZE, stickyCorner } from '../../lib/colors';
import { liveDrawing, svgSrc } from '../../lib/drawing';
import { blockHeight, clamp, isFixedHeight, isEditableTarget, modKey, sanitizeHtml, snap, textToHtml } from '../../lib/util';
import { BlockFrame } from './BlockFrame';
import { FrameChrome } from './FrameChrome';
import { boundsOf, guideLines, nearestShift, type Guide, type Rect as BoxRect } from '../../lib/guides';
import { containingFrame, frameDescendants, hiddenBlockIds, paintOrder } from '../../lib/frames';
import { sidePoint, type Side } from '../../lib/arrows';
import { ArrowLayer, type ConnectingLine } from './ArrowLayer';
import { CanvasCtx, type CanvasCtxValue } from './context';

const EMPTY: Block[] = [];
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const MARGIN = 640; // empty canvas kept beyond the furthest block
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
  const drawMode = useDraw((s) => s.open);
  const pendingScroll = useRef<Point | null>(null);
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
    return { x: (clientX - r.left + v.scrollLeft) / z, y: (clientY - r.top + v.scrollTop) / z };
  }, []);

  const heightOf = (b: Block) => heights.current.get(b.id) ?? blockHeight(b);

  const updateExtent = useCallback(() => {
    const v = viewportRef.current, world = worldRef.current, sizer = sizerRef.current;
    if (!v || !world || !sizer) return;
    const z = useCanvas.getState().zoom;
    let mx = 0, my = 0;
    for (const b of blocksRef.current) {
      mx = Math.max(mx, b.x + b.w);
      my = Math.max(my, b.y + (heights.current.get(b.id) ?? blockHeight(b)));
    }
    const ink = liveDrawing(drawingRef.current);
    if (ink) {
      mx = Math.max(mx, ink.x + ink.w);
      my = Math.max(my, ink.y + ink.h);
    }
    const W = Math.max(v.clientWidth / z, mx + MARGIN);
    const H = Math.max(v.clientHeight / z, my + MARGIN);
    world.style.width = W + 'px';
    world.style.height = H + 'px';
    world.style.transform = `scale(${z})`;
    sizer.style.width = W * z + 'px';
    sizer.style.height = H * z + 'px';
  }, []);

  useLayoutEffect(() => {
    updateExtent();
    const v = viewportRef.current;
    if (v && pendingScroll.current) {
      v.scrollLeft = pendingScroll.current.x;
      v.scrollTop = pendingScroll.current.y;
      pendingScroll.current = null;
    }
  }, [blocks, drawing, zoom, updateExtent]);

  useEffect(() => {
    const ro = new ResizeObserver(() => updateExtent());
    ro.observe(viewportRef.current!);
    return () => ro.disconnect();
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
    return {
      x: snap(Math.max(24, (v.scrollLeft + v.clientWidth / 2) / z - w / 2 + off)),
      y: snap(Math.max(24, (v.scrollTop + v.clientHeight / 2.5) / z - h / 2 + off)),
    };
  }, []);

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
    return { zoom: useCanvas.getState().zoom, left: v?.scrollLeft ?? 0, top: v?.scrollTop ?? 0 };
  }, []);

  const setView = useCallback((next: CanvasView) => {
    const v = viewportRef.current;
    if (!v) return;
    const z = clamp(next.zoom, MIN_ZOOM, MAX_ZOOM);
    if (z === useCanvas.getState().zoom) {
      v.scrollLeft = next.left;
      v.scrollTop = next.top;
    } else {
      pendingScroll.current = { x: next.left, y: next.top };
      useCanvas.setState({ zoom: z });
    }
  }, []);

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
      const minX = Math.min(...[...starts.values()].map((p) => p.x));
      const minY = Math.min(...[...starts.values()].map((p) => p.y));
      const rectOf = (b: Block): BoxRect => ({ x: b.x, y: b.y, w: b.w, h: heights.current.get(b.id) ?? blockHeight(b) });
      const group = boundsOf(page.blocks.filter((b) => starts.has(b.id)).map(rectOf));
      const others = page.blocks.filter((b) => !starts.has(b.id)).map(rectOf);
      beginGesture(pageId);

      const v = viewportRef.current!;
      const s0 = { x: e.clientX, y: e.clientY, sl: v.scrollLeft, st: v.scrollTop };
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
        let dx = (last.clientX - s0.x + v.scrollLeft - s0.sl) / z;
        let dy = (last.clientY - s0.y + v.scrollTop - s0.st) / z;
        let lines: Guide[] = [];
        if (!last.altKey) {
          // Line up with other boxes when close; otherwise snap to the 8 px grid.
          const moved = { ...group, x: group.x + dx, y: group.y + dy };
          const sx = nearestShift(moved, others, SNAP_PX / z, 'x');
          const sy = nearestShift(moved, others, SNAP_PX / z, 'y');
          dx = sx !== null ? dx + sx : snap(anchor.x + dx) - anchor.x;
          dy = sy !== null ? dy + sy : snap(anchor.y + dy) - anchor.y;
          lines = guideLines({ ...group, x: group.x + dx, y: group.y + dy }, others);
        }
        dx = Math.max(dx, -minX);
        dy = Math.max(dy, -minY);
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
    [pageId, setGuides],
  );

  const startResize = useCallback(
    (e: React.PointerEvent, id: string) => {
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
        let w = Math.max(64, s0.w + (last.clientX - s0.x) / z);
        let h = Math.max(32, s0.h + (last.clientY - s0.y) / z);
        const keepRatio = b.type === 'image' && !last.shiftKey;
        let lines: Guide[] = [];
        if (!last.altKey) {
          // The right and bottom edges line up with other boxes when close.
          const sx = nearestShift({ x: b.x, y: b.y, w, h }, others, SNAP_PX / z, 'x', ['end']);
          w = sx !== null ? w + sx : snap(w);
          if (!keepRatio) {
            const sy = nearestShift({ x: b.x, y: b.y, w, h }, others, SNAP_PX / z, 'y', ['end']);
            h = sy !== null ? h + sy : snap(h);
          }
        }
        if (keepRatio) h = Math.round(w / aspect);
        if (!last.altKey) lines = guideLines({ x: b.x, y: b.y, w, h }, others, ['end'], keepRatio ? [] : ['end']);
        setGuides(lines);
        mutatePage(
          pageId,
          (p) => {
            const t = p.blocks.find((x) => x.id === id);
            if (t) {
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
    const p = worldPoint(e.clientX, e.clientY);
    // Render the new box synchronously so typing goes straight into it.
    let id = '';
    flushSync(() => {
      id = addBlock(pageId, 'text', { x: snap(p.x - 8), y: snap(p.y - 16) });
      setSelected([id]);
    });
    focusBlock(id);
  };

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer.
  useEffect(() => {
    const v = viewportRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = v.getBoundingClientRect();
      zoomTo(useCanvas.getState().zoom * Math.exp(-e.deltaY * 0.0022), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    v.addEventListener('wheel', onWheel, { passive: false });
    return () => v.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  // Two-finger pinch zooms on phones; one finger keeps scrolling natively.
  useEffect(() => {
    const v = viewportRef.current!;
    let start: { dist: number; zoom: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { dist: dist(e.touches), zoom: useCanvas.getState().zoom };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const r = v.getBoundingClientRect();
      const mid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top,
      };
      zoomTo(start.zoom * (dist(e.touches) / start.dist), mid);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    v.addEventListener('touchstart', onStart, { passive: true });
    v.addEventListener('touchmove', onMove, { passive: false });
    v.addEventListener('touchend', onEnd);
    v.addEventListener('touchcancel', onEnd);
    return () => {
      v.removeEventListener('touchstart', onStart);
      v.removeEventListener('touchmove', onMove);
      v.removeEventListener('touchend', onEnd);
      v.removeEventListener('touchcancel', onEnd);
    };
  }, [zoomTo]);

  /* ---------- keyboard & clipboard ---------- */

  useEffect(() => {
    const blocked = () => !!(useUi.getState().dialog || useUi.getState().menu || useDraw.getState().open);

    const onKeyDown = (e: KeyboardEvent) => {
      if (blocked()) return;
      const a = document.activeElement;
      if (isEditableTarget(a)) {
        if (e.key === 'Escape' && a instanceof HTMLElement && worldRef.current?.contains(a)) {
          a.blur();
          const id = a.closest<HTMLElement>('[data-id]')?.dataset.id;
          if (id) setSelected([id]);
        }
        return;
      }
      const mod = modKey(e);
      const key = e.key.toLowerCase();

      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        spaceDown.current = true;
        setPanMode((m) => (m === 'panning' ? m : 'ready'));
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(pageId);
        else undo(pageId);
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        redo(pageId);
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomTo(useCanvas.getState().zoom * 1.2);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        zoomTo(useCanvas.getState().zoom / 1.2);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        zoomTo(1);
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        const hidden = hiddenBlockIds(blocksRef.current);
        setSelected(blocksRef.current.filter((b) => !hidden.has(b.id)).map((b) => b.id));
        return;
      }

      if (isStickyKey(e)) {
        // At the pointer if it is over the canvas, otherwise in the middle of what is visible.
        e.preventDefault();
        const r = viewportRef.current?.getBoundingClientRect();
        const m = pointer.current;
        const over = !!(r && m && m.x >= r.left && m.x <= r.right && m.y >= r.top && m.y <= r.bottom);
        const at = over ? stickyCorner(worldPoint(m!.x, m!.y)) : visibleSpot(STICKY_SIZE, STICKY_SIZE);
        let id = '';
        flushSync(() => {
          id = addBlock(pageId, 'sticky', at);
          setSelected([id]);
        });
        focusBlock(id);
        return;
      }

      const sel = useCanvas.getState().selected;
      if (!sel.length) {
        const arrowSel = useCanvas.getState().selectedArrow;
        if (arrowSel && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault();
          deleteArrows(pageId, [arrowSel]);
          setSelectedArrow(null);
        } else if (arrowSel && e.key === 'Escape') {
          setSelectedArrow(null);
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteBlocks(pageId, sel);
        setSelected([]);
      } else if (mod && key === 'd' && !e.altKey) {
        e.preventDefault();
        setSelected(duplicateBlocks(pageId, sel));
      } else if (e.key === 'Escape') {
        setSelected([]);
      } else if (e.key === 'Enter' && sel.length === 1) {
        e.preventDefault();
        focusBlock(sel[0]);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 8;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        // Nudging a frame also nudges everything nested inside it.
        const nudgeIds = new Set(sel);
        for (const sid of sel) {
          const b = blocksRef.current.find((x) => x.id === sid);
          if (b?.type === 'frame') for (const d of frameDescendants(blocksRef.current, sid)) nudgeIds.add(d);
        }
        mutatePage(
          pageId,
          (p) => {
            for (const b of p.blocks) {
              if (!nudgeIds.has(b.id)) continue;
              b.x = Math.max(0, b.x + dx);
              b.y = Math.max(0, b.y + dy);
            }
          },
          { history: { key: 'nudge:' + sel.join(',') } },
        );
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spaceDown.current = false;
        setPanMode((m) => (m === 'panning' ? m : 'off'));
      }
    };
    const onBlur = () => {
      spaceDown.current = false;
      setPanMode('off');
    };

    const onPaste = (e: ClipboardEvent) => {
      if (blocked() || isEditableTarget(document.activeElement)) return;
      const files = imageFiles(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        void addImages(pageId, files, visibleSpot(360, 260)).then((ids) => ids.length && setSelected(ids));
        return;
      }
      const html = e.clipboardData?.getData('text/html');
      const text = e.clipboardData?.getData('text/plain');
      if (!html && !text) return;
      e.preventDefault();
      const id = addBlock(pageId, 'text', visibleSpot(320, 80), {
        w: 320,
        html: html ? sanitizeHtml(html) : textToHtml(text ?? ''),
      });
      setSelected([id]);
    };

    const onPointer = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onPointer);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('paste', onPaste);
    };
  }, [pageId, focusBlock, visibleSpot, zoomTo, worldPoint]);

  /* ---------- file drop ---------- */

  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  /* ---------- render ---------- */

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
          void addImages(pageId, Array.from(e.dataTransfer.files), { x: snap(p.x - 40), y: snap(p.y - 40) }).then(
            (ids) => ids.length && setSelected(ids),
          );
        }}
      >
        <div ref={sizerRef} className="sizer">
          <div ref={worldRef} className="world">
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
                style={{ left: drawing!.x, top: drawing!.y, width: drawing!.w, height: drawing!.h }}
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
