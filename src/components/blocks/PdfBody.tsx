import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { PdfBlock } from '../../types';
import { clampPage } from '../../lib/media';
import { pdfDocument } from '../../lib/pdf';
import { useCanvasCtx } from '../editor/context';
import { Icon } from '../ui/Icon';

/** A PDF drawn one page at a time, fitted to the box's width; the box scrolls if the page is taller. */
export function PdfBody({ block }: { block: PdfBlock }) {
  const { startMove } = useCanvasCtx();
  const [doc, setDoc] = useState<PDFDocumentProxy | null | undefined>(undefined); // undefined = loading, null = failed
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let alive = true;
    setDoc(undefined);
    setError('');
    pdfDocument(block.fileId)
      .then((d) => alive && setDoc(d))
      .catch((e) => {
        if (!alive) return;
        setDoc(null);
        setError(e instanceof Error ? e.message : 'this PDF can’t be shown');
      });
    return () => {
      alive = false;
    };
  }, [block.fileId]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  const pages = doc?.numPages ?? block.pages ?? 1;
  const current = clampPage(page, pages);

  useEffect(() => {
    const c = canvas.current;
    if (!doc || !c || width < 40) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    // One render at a time per canvas: wait for the previous (cancelled) one to let go of it.
    const run = drawing.current.catch(() => {}).then(async () => {
      if (cancelled) return;
      const p = await doc.getPage(current);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const fit = width / p.getViewport({ scale: 1 }).width;
      const vp = p.getViewport({ scale: fit * dpr });
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      c.style.width = `${width}px`;
      c.style.height = `${Math.floor(vp.height / dpr)}px`;
      task = p.render({ canvas: c, viewport: vp });
      await task.promise;
    });
    drawing.current = run;
    run.catch((e) => {
      if ((e as { name?: string })?.name !== 'RenderingCancelledException' && !cancelled) setError('This page couldn’t be drawn.');
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, current, width]);

  return (
    <div className="body pdf-body">
      <div className="pdf-page" ref={wrap}>
        {doc ? (
          <canvas ref={canvas} role="img" aria-label={`${block.name}, page ${current} of ${pages}`} />
        ) : (
          <div className="missing">{doc === null ? error || 'PDF not found' : 'Loading…'}</div>
        )}
        {doc && error && <div className="missing">{error}</div>}
      </div>
      <div className="pdf-bar">
        <span className="pdf-name" title={block.name} onPointerDown={(e) => startMove(e, block.id)}>
          <Icon name="pdf" size={16} />
          {block.name}
        </span>
        <button className="pdf-nav" aria-label="Previous page" disabled={!doc || current <= 1} onClick={() => setPage(current - 1)}>
          <Icon name="back" size={16} />
        </button>
        <span className="pdf-count" aria-live="polite">
          {current} / {pages}
        </span>
        <button className="pdf-nav next" aria-label="Next page" disabled={!doc || current >= pages} onClick={() => setPage(current + 1)}>
          <Icon name="back" size={16} />
        </button>
      </div>
    </div>
  );
}
