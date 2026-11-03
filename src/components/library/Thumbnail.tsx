import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Arrow, Block, PageDrawing } from '../../types';
import { frameInk, tintVars } from '../../lib/colors';
import { liveDrawing, svgSrc, unionBounds } from '../../lib/drawing';
import { blockHeight, colorVar, isFixedHeight, sanitizeHtml } from '../../lib/util';
import { routeBetween } from '../../lib/arrows';
import { hiddenBlockIds, paintOrder } from '../../lib/frames';
import { useImageUrl } from '../../lib/useImageUrl';
import { formatDuration } from '../../lib/media';

const PAD = 36;
const MAX_SCALE = 0.42;
const EMPTY_ARROWS: Arrow[] = [];

/** A miniature of the page: the real blocks, laid out the same way, scaled to fit the card. */
export const Thumbnail = memo(function Thumbnail({
  blocks,
  arrows = EMPTY_ARROWS,
  drawing,
}: {
  blocks: Block[];
  arrows?: Arrow[];
  drawing?: PageDrawing | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = useMemo(() => {
    const hidden = hiddenBlockIds(blocks);
    return blocks.filter((b) => !hidden.has(b.id));
  }, [blocks]);

  const ink = liveDrawing(drawing);
  const layout = useMemo(() => {
    const boxes = visible.map((b) => ({ x: b.x, y: b.y, w: b.w, h: blockHeight(b) }));
    if (ink) boxes.push(ink);
    if (!boxes.length) return null;
    const { minX, minY, maxX, maxY } = unionBounds(boxes);
    return {
      minX, minY,
      w: maxX - minX + PAD * 2,
      h: maxY - minY + PAD * 2,
      sorted: paintOrder(visible),
    };
  }, [visible, ink]);

  let transform = 'scale(0)';
  if (layout && box.w) {
    const s = Math.min(box.w / layout.w, box.h / layout.h, MAX_SCALE);
    const tx = Math.max(0, (box.w - layout.w * s) / 2);
    const ty = Math.max(0, (box.h - layout.h * s) / 2);
    transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  return (
    <div className="thumb" ref={ref} aria-hidden="true">
      {!layout ? (
        <div className="thumb-empty">Empty page</div>
      ) : (
        <div className="mini" style={{ width: layout.w, height: layout.h, transform }}>
          {layout.sorted.map((b) => (
            <div
              key={b.id}
              className={`block b-${b.type}${b.type === 'text' && b.fill ? ' fill' : ''}`}
              style={{
                left: b.x - layout.minX + PAD,
                top: b.y - layout.minY + PAD,
                width: b.w,
                ...(isFixedHeight(b) || b.type === 'frame' ? { height: blockHeight(b) } : { minHeight: b.h }),
                ...tintVars(b),
              } as CSSProperties}
            >
              <StaticBody block={b} />
            </div>
          ))}
          {ink && (
            <img
              className="ink"
              alt=""
              src={svgSrc(ink.preview)}
              style={{ left: ink.x - layout.minX + PAD, top: ink.y - layout.minY + PAD, width: ink.w, height: ink.h }}
            />
          )}
          {arrows.length > 0 && (
            <svg className="mini-arrows" aria-hidden="true">
              {arrows.map((a) => {
                const fromB = visible.find((b) => b.id === a.from);
                const toB = visible.find((b) => b.id === a.to);
                if (!fromB || !toB) return null;
                const route = routeBetween(
                  { x: fromB.x, y: fromB.y, w: fromB.w, h: blockHeight(fromB) },
                  { x: toB.x, y: toB.y, w: toB.w, h: blockHeight(toB) },
                );
                const x1 = route.from.x - layout.minX + PAD, y1 = route.from.y - layout.minY + PAD;
                const x2 = route.to.x - layout.minX + PAD, y2 = route.to.y - layout.minY + PAD;
                return (
                  <line key={a.id} x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray={a.style === 'dashed' ? '4 3' : undefined} />
                );
              })}
            </svg>
          )}
        </div>
      )}
    </div>
  );
});

export function StaticBody({ block: b }: { block: Block }) {
  switch (b.type) {
    case 'text':
    case 'sticky':
      return <div className="body prose" dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.html) }} />;
    case 'checklist':
      return (
        <div className="body">
          {b.items.map((i) => (
            <div key={i.id} className={'ci' + (i.done ? ' done' : '')}>
              <span className={'fake-check' + (i.done ? ' on' : '')} />
              <div className="t">{i.text}</div>
            </div>
          ))}
        </div>
      );
    case 'code':
      return (
        <div className="body">
          <pre>{b.code}</pre>
        </div>
      );
    case 'table':
      return (
        <div className="body">
          <table>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'image':
      return <StaticImage imageId={b.imageId} />;
    case 'audio':
      return (
        <div className="body audio-body static-file">
          <div className="audio-head">
            <span className="audio-name">🔊 {b.name}</span>
            {b.duration ? <span className="audio-len">{formatDuration(b.duration)}</span> : null}
          </div>
          <div className="static-bar" />
        </div>
      );
    case 'pdf':
      return (
        <div className="body pdf-body static-file">
          <div className="static-page">
            <span>PDF</span>
            <strong>{b.name}</strong>
            {b.pages ? <em>{b.pages} page{b.pages === 1 ? '' : 's'}</em> : null}
          </div>
        </div>
      );
    case 'frame':
      return (
        <>
          <div className="frame-body" style={{ background: `color-mix(in srgb, ${colorVar(b.color)} 12%, transparent)`, borderColor: colorVar(b.color) }} />
          <div className="frame-head" style={{ background: colorVar(b.color), color: frameInk(b.color) ?? undefined }}>
            <span className="frame-title-static">{b.title || 'Frame'}</span>
          </div>
        </>
      );
  }
}

function StaticImage({ imageId }: { imageId: string }) {
  const url = useImageUrl(imageId);
  return <div className="body">{url ? <img src={url} alt="" draggable={false} /> : <div className="missing" />}</div>;
}
