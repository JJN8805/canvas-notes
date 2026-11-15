import { memo } from 'react';
import type { Block, FrameBlock } from '../../types';
import { noteVar, tintVars } from '../../lib/colors';
import { isStyle, kindClass } from '../../lib/note';
import { SLIDE_H, SLIDE_W, slideContents } from '../../lib/office/app';
import { StaticBody } from '../library/Thumbnail';

/** One slide drawn at a size: the real boxes, scaled. Used for the slide list and for the full-screen show. */
export const SlideView = memo(function SlideView({ blocks, slide, width }: { blocks: readonly Block[]; slide: FrameBlock; width: number }) {
  const scale = width / SLIDE_W;
  const bg = slide.slide?.bg;
  return (
    <div className="slide-view" style={{ width, height: SLIDE_H * scale, background: bg ? `color-mix(in srgb, ${noteVar(bg)} 60%, #fff)` : '#fff' }}>
      <div className="slide-stage" style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})` }}>
        {slideContents(blocks, slide.id).map((b) => (
          <div
            key={b.id}
            className={`block b-${kindClass(b)}${isStyle(b, 'text') && b.fill ? ' fill' : ''}`}
            style={{ left: b.x - slide.x, top: b.y - slide.y, width: b.w, minHeight: b.h, ...tintVars(b) } as React.CSSProperties}
          >
            <StaticBody block={b} />
          </div>
        ))}
      </div>
    </div>
  );
});
