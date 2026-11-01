import { useMemo } from 'react';
import type { Arrow, Block } from '../../types';
import { blockHeight } from '../../lib/util';
import { routeBetween } from '../../lib/arrows';
import { setSelectedArrow, useCanvas } from '../../store/canvas';
import { useNotes } from '../../store/notes';
import { ArrowBar } from './ArrowBar';

const EMPTY_ARROWS: Arrow[] = [];

function headPolygon(tip: { x: number; y: number }, ux: number, uy: number, size: number): string {
  const backX = tip.x - ux * size, backY = tip.y - uy * size;
  const px = -uy, py = ux;
  const w = size * 0.42;
  return `${tip.x},${tip.y} ${backX + px * w},${backY + py * w} ${backX - px * w},${backY - py * w}`;
}

export interface ConnectingLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** All of a page's arrows, drawn as an SVG overlay above the blocks, plus the
 *  menu bar for whichever one is selected. Routes are recomputed from the
 *  blocks' current rects every render, so moving/resizing stays attached for free. */
export function ArrowLayer({
  pageId,
  blocks,
  heights,
  connecting,
}: {
  pageId: string;
  blocks: Block[];
  heights: React.MutableRefObject<Map<string, number>>;
  connecting: ConnectingLine | null;
}) {
  const arrows = useNotes((s) => s.pages[pageId]?.arrows ?? EMPTY_ARROWS);
  const selectedArrow = useCanvas((s) => s.selectedArrow);
  const zoom = useCanvas((s) => s.zoom);
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);

  const strokeW = 1.5 / zoom;
  const headSize = 9 / zoom;
  const hitW = 10 / zoom;

  let selectedMid: { x: number; y: number } | null = null;
  let selectedObj: Arrow | null = null;

  const shapes = arrows.map((a) => {
    const fromB = byId.get(a.from);
    const toB = byId.get(a.to);
    if (!fromB || !toB) return null;
    const heightOf = (b: Block) => heights.current.get(b.id) ?? blockHeight(b);
    const route = routeBetween(
      { x: fromB.x, y: fromB.y, w: fromB.w, h: heightOf(fromB) },
      { x: toB.x, y: toB.y, w: toB.w, h: heightOf(toB) },
    );
    const sel = a.id === selectedArrow;
    if (sel) {
      selectedMid = { x: (route.from.x + route.to.x) / 2, y: (route.from.y + route.to.y) / 2 };
      selectedObj = a;
    }
    const dx = route.to.x - route.from.x, dy = route.to.y - route.from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const color = sel ? 'var(--accent)' : 'var(--ink)';
    return (
      <g key={a.id}>
        <line
          x1={route.from.x}
          y1={route.from.y}
          x2={route.to.x}
          y2={route.to.y}
          stroke={color}
          strokeWidth={strokeW}
          strokeDasharray={a.style === 'dashed' ? `${6 / zoom} ${4 / zoom}` : undefined}
        />
        {(a.heads === 'one' || a.heads === 'both') && <polygon points={headPolygon(route.to, ux, uy, headSize)} fill={color} />}
        {a.heads === 'both' && <polygon points={headPolygon(route.from, -ux, -uy, headSize)} fill={color} />}
        {a.label && (
          // The label sits on the middle of the line, with a halo in the page colour so the line doesn't run through the letters.
          <text
            x={(route.from.x + route.to.x) / 2}
            y={(route.from.y + route.to.y) / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={13}
            fill={sel ? 'var(--accent)' : 'var(--ink)'}
            stroke="var(--desk)"
            strokeWidth={5}
            paintOrder="stroke"
            strokeLinejoin="round"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {a.label}
          </text>
        )}
        <line
          className="arrow-hit"
          x1={route.from.x}
          y1={route.from.y}
          x2={route.to.x}
          y2={route.to.y}
          stroke="transparent"
          strokeWidth={hitW}
          onPointerDown={(e) => {
            e.stopPropagation();
            setSelectedArrow(a.id);
          }}
        />
      </g>
    );
  });

  return (
    <>
      <svg className="arrow-layer" aria-hidden="true">
        {shapes}
        {connecting && (
          <line
            x1={connecting.x1}
            y1={connecting.y1}
            x2={connecting.x2}
            y2={connecting.y2}
            stroke="var(--accent)"
            strokeWidth={strokeW}
            strokeDasharray={`${4 / zoom} ${3 / zoom}`}
          />
        )}
      </svg>
      {selectedObj && selectedMid && <ArrowBar pageId={pageId} arrow={selectedObj} mid={selectedMid} />}
    </>
  );
}
