import type React from 'react';
import type { ResizeDir } from './context';

const DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Handles on every edge and corner of a selected box. Corners are visible squares, edges are invisible strips. */
export function ResizeHandles({ onStart }: { onStart: (e: React.PointerEvent, dir: ResizeDir) => void }) {
  return (
    <>
      {DIRS.map((dir) => (
        <div key={dir} className={`resize resize-${dir}`} aria-hidden="true" title="Drag to resize" onPointerDown={(e) => onStart(e, dir)} />
      ))}
    </>
  );
}
