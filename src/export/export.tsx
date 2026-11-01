import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import TurndownService from 'turndown';
import { zipSync } from 'fflate';
import type { Arrow, Block, ChecklistBlock, CodeBlock, ImageBlock, Page, PageDrawing, StickyBlock, TableBlock, TextBlock } from '../types';
import { tintVars } from '../lib/colors';
import { liveDrawing, svgSrc, unionBounds } from '../lib/drawing';
import { BLOCK_LABEL, blockHeight, blockText, isFixedHeight } from '../lib/util';
import { hiddenBlockIds, paintOrder } from '../lib/frames';
import { routeBetween, type Rect as ArrowRect } from '../lib/arrows';
import { getStorage, useNotes } from '../store/notes';
import { toast } from '../store/ui';
import { isTauri } from '../storage';
import { base64ToBytes } from '../storage/types';
import { StaticBody } from '../components/library/Thumbnail';

export type ExportFormat = 'markdown' | 'pdf' | 'png';

const PAD = 48;

/* ------------------------------------------------------------------ */
/* Picture of the page (PNG and PDF)                                   */
/* ------------------------------------------------------------------ */

function bounds(blocks: Block[], drawing: PageDrawing | null) {
  const boxes = blocks.map((b) => ({ x: b.x, y: b.y, w: b.w, h: blockHeight(b) }));
  if (drawing) boxes.push(drawing);
  if (!boxes.length) return { x: 0, y: 0, w: 800, h: 500 };
  const { minX, minY, maxX, maxY } = unionBounds(boxes);
  return { x: minX - PAD, y: minY - PAD, w: maxX - minX + PAD * 2, h: maxY - minY + PAD * 2 };
}

/**
 * Draws the page into a canvas: the same boxes as on screen, always in the
 * light theme, on white, cropped to the content.
 */
export async function renderPage(page: Page, maxScale = 2): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const { toCanvas, getFontEmbedCSS } = await import('html-to-image');
  // Boxes hidden behind a collapsed frame (and their arrows, below) are left out of exports too.
  const hidden = hiddenBlockIds(page.blocks);
  const visible = page.blocks.filter((b) => !hidden.has(b.id));
  const ink = liveDrawing(page.drawing);
  const box = bounds(visible, ink);
  const host = document.createElement('div');
  host.className = 'export-root';
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${box.w}px;height:${box.h}px;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        <div className="export-page" style={{ width: box.w, height: box.h }}>
          {paintOrder(visible).map((b) => (
            <div
              key={b.id}
              className={`block b-${b.type}${b.type === 'text' && b.fill ? ' fill' : ''}`}
              style={{
                left: b.x - box.x,
                top: b.y - box.y,
                width: b.w,
                ...(isFixedHeight(b) || b.type === 'frame' ? { height: blockHeight(b) } : { minHeight: b.h }),
                ...tintVars(b),
              } as React.CSSProperties}
            >
              <StaticBody block={b} />
            </div>
          ))}
        </div>,
      ),
    );

    // Wait for fonts and for every image to arrive and decode.
    await document.fonts.ready;
    const expected = visible.filter((b) => b.type === 'image').length;
    const deadline = Date.now() + 8000;
    while (host.querySelectorAll('img').length < expected && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    await Promise.all(Array.from(host.querySelectorAll('img')).map((img) => img.decode().catch(() => undefined)));

    const node = host.firstElementChild as HTMLElement;
    // Keep within what browsers can draw (about 16k px per side).
    const scale = Math.max(0.5, Math.min(maxScale, 14000 / Math.max(box.w, box.h)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(box.w * scale);
    canvas.height = Math.round(box.h * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, box.w, box.h);

    // Draw box by box, bottom to top. Text, lists, code and tables go through
    // html-to-image; pictures are drawn directly, because WebKit (the Linux
    // desktop app) leaves images out of html-to-image's output.
    const fontEmbedCSS = await getFontEmbedCSS(node).catch(() => '');
    for (const el of Array.from(node.children) as HTMLElement[]) {
      const x = el.offsetLeft, y = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
      const img = el.classList.contains('b-image') ? el.querySelector('img') : null;
      if (el.classList.contains('b-image')) {
        if (img && img.naturalWidth) drawCover(ctx, img, x, y, w, h, 4);
        continue;
      }
      // Snapshot the box at the origin. Setting this on the element itself (rather than
      // html-to-image's style option) works the same in WebKit and Chromium.
      const saved = el.style.cssText;
      el.style.position = 'relative';
      el.style.left = '0px';
      el.style.top = '0px';
      try {
        const part = await toCanvas(el, { pixelRatio: scale, width: w, height: h, fontEmbedCSS, cacheBust: false });
        ctx.drawImage(part, x, y, w, h);
      } finally {
        el.style.cssText = saved;
      }
    }
    for (const a of page.arrows) {
      const fromB = visible.find((bl) => bl.id === a.from);
      const toB = visible.find((bl) => bl.id === a.to);
      if (fromB && toB) drawArrow(ctx, a, fromB, toB, box);
    }
    if (ink) {
      // Drawn directly like pictures, for the same WebKit reason. The ink sits above the boxes, as on the canvas.
      const pic = new Image();
      pic.src = svgSrc(ink.preview);
      if (await pic.decode().then(() => true, () => false)) ctx.drawImage(pic, ink.x - box.x, ink.y - box.y, ink.w, ink.h);
    }
    return { canvas, width: box.w, height: box.h };
  } finally {
    root.unmount();
    host.remove();
  }
}

function rectOfBlock(b: Block): ArrowRect {
  return { x: b.x, y: b.y, w: b.w, h: blockHeight(b) };
}

function drawArrowhead(ctx: CanvasRenderingContext2D, tip: { x: number; y: number }, ux: number, uy: number) {
  const size = 9;
  const backX = tip.x - ux * size, backY = tip.y - uy * size;
  const px = -uy, py = ux, w = size * 0.42;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(backX + px * w, backY + py * w);
  ctx.lineTo(backX - px * w, backY - py * w);
  ctx.closePath();
  ctx.fill();
}

/** Draws one connector: a line between the two blocks' nearest sides, its arrowhead(s) and label. */
function drawArrow(ctx: CanvasRenderingContext2D, a: Arrow, fromB: Block, toB: Block, box: { x: number; y: number }) {
  const route = routeBetween(rectOfBlock(fromB), rectOfBlock(toB));
  const p1 = { x: route.from.x - box.x, y: route.from.y - box.y };
  const p2 = { x: route.to.x - box.x, y: route.to.y - box.y };
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  ctx.save();
  ctx.strokeStyle = '#17202a';
  ctx.fillStyle = '#17202a';
  ctx.lineWidth = 1.5;
  ctx.setLineDash(a.style === 'dashed' ? [6, 4] : []);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (a.heads === 'one' || a.heads === 'both') drawArrowhead(ctx, p2, ux, uy);
  if (a.heads === 'both') drawArrowhead(ctx, p1, -ux, -uy);
  if (a.label) {
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    ctx.font = '13px sans-serif';
    const w = ctx.measureText(a.label).width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mid.x - w / 2 - 4, mid.y - 9, w + 8, 18);
    ctx.fillStyle = '#17202a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(a.label, mid.x, mid.y);
  }
  ctx.restore();
}

/** Like CSS object-fit: cover, with rounded corners. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, radius: number) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const r = Math.max(w / iw, h / ih);
  const sw = w / r, sh = h / r;
  ctx.save();
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, radius);
  else ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
}

function canvasBytes(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error('The image couldn’t be created'))),
      type,
      quality,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

/**
 * A one-page PDF showing a JPEG, sized to the page content.
 * Written by hand: a PDF holding one image needs only six small objects.
 */
export function jpegToPdf(jpeg: Uint8Array, pixelWidth: number, pixelHeight: number, cssWidth: number, cssHeight: number): Uint8Array<ArrayBuffer> {
  // 96 CSS px = 72 pt. PDF viewers struggle above 14,400 pt per side, so shrink very large pages.
  const pt = Math.min(0.75, 14400 / Math.max(cssWidth, cssHeight));
  const W = +(cssWidth * pt).toFixed(2);
  const H = +(cssHeight * pt).toFixed(2);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (p: Uint8Array | string) => {
    const bytes = typeof p === 'string' ? enc.encode(p) : p;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push('\nendstream\nendobj\n');
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(new ArrayBuffer(length));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

let turndown: TurndownService | null = null;
function htmlToMarkdown(html: string): string {
  if (!turndown) {
    turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
    turndown.addRule('strike', { filter: ['s', 'del'], replacement: (c) => `~~${c}~~` });
    turndown.addRule('underline', { filter: ['u'], replacement: (c) => `<u>${c}</u>` });
  }
  return turndown.turndown(html).trim();
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>') || ' ';

/** Blocks top-to-bottom; boxes side by side (tops within 40 px) left-to-right. */
export function readingOrder(blocks: Block[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.y - b.y);
  const rows: Block[][] = [];
  for (const b of sorted) {
    const row = rows[rows.length - 1];
    if (row && b.y - row[0].y < 40) row.push(b);
    else rows.push([b]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}

/** Emits one level of the containment tree: a frame becomes a heading (nesting depth
 *  maps to heading depth) followed by its own contents, recursively; other blocks go
 *  through the normal per-type rendering. `all` is the full (visible) block list, used
 *  to look up each frame's direct children. */
function blocksToMarkdown(blocks: Block[], all: Block[], imagePath: (b: ImageBlock) => string, headingDepth: number, out: string[]) {
  for (const b of readingOrder(blocks)) {
    if (b.type === 'frame') {
      out.push(`${'#'.repeat(Math.min(headingDepth, 6))} ${b.title || 'Frame'}`);
      blocksToMarkdown(all.filter((x) => x.frameId === b.id), all, imagePath, headingDepth + 1, out);
      continue;
    }
    switch (b.type) {
      case 'text': {
        const md = htmlToMarkdown((b as TextBlock).html);
        if (md) out.push(md);
        break;
      }
      case 'sticky': {
        // A note: a blockquote line, with its colour kept in a comment so it survives a round trip.
        const text = htmlToMarkdown((b as StickyBlock).html);
        if (!text) break;
        const lines = text.split('\n').map((l, i) => (i === 0 ? `> 📝 ${l}` : `> ${l}`));
        out.push((b.tint ? `<!-- sticky color: ${b.tint} -->\n` : '') + lines.join('\n'));
        break;
      }
      case 'checklist':
        out.push((b as ChecklistBlock).items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n'));
        break;
      case 'code': {
        const code = (b as CodeBlock).code;
        const fence = code.includes('```') ? '````' : '```';
        out.push(`${fence}\n${code}\n${fence}`);
        break;
      }
      case 'table': {
        const rows = (b as TableBlock).rows;
        if (!rows.length) break;
        const [head, ...body] = rows;
        out.push(
          [`| ${head.map(cell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n'),
        );
        break;
      }
      case 'image': {
        const img = b as ImageBlock;
        out.push(`![${(img.alt ?? '').replace(/[[\]]/g, '')}](${imagePath(img)})`);
        break;
      }
    }
  }
}

export function pageToMarkdown(page: Page, imagePath: (b: ImageBlock) => string, drawingPath = ''): string {
  const out: string[] = [`# ${page.title || 'Untitled'}`];
  if (page.tags.length) out.push(page.tags.map((t) => `#${t}`).join(' '));
  // Boxes hidden behind a collapsed frame (and their arrows, below) are left out of exports too.
  const hidden = hiddenBlockIds(page.blocks);
  const visible = page.blocks.filter((b) => !hidden.has(b.id));
  blocksToMarkdown(visible.filter((b) => !b.frameId), visible, imagePath, 2, out);
  if (drawingPath && liveDrawing(page.drawing)) out.push(`![Drawing](${drawingPath})`);
  const visibleIds = new Set(visible.map((b) => b.id));
  const arrows = page.arrows.filter((a) => visibleIds.has(a.from) && visibleIds.has(a.to));
  if (arrows.length) {
    const labelOf = (id: string): string => {
      const b = page.blocks.find((x) => x.id === id);
      if (!b) return 'Deleted block';
      const text = blockText(b).split('\n').map((l) => l.trim()).find((l) => l);
      if (text) return text.length > 40 ? text.slice(0, 40) + '…' : text;
      return BLOCK_LABEL[b.type];
    };
    out.push(
      '## Connections\n\n' +
        arrows
          .map((a) => {
            const glyph = a.heads === 'none' ? '—' : a.heads === 'both' ? '↔' : '→';
            const label = a.label ? ` (${a.label})` : '';
            return `- ${labelOf(a.from)} ${glyph} ${labelOf(a.to)}${label}`;
          })
          .join('\n'),
    );
  }
  return out.join('\n\n') + '\n';
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

/** Markdown file, or a zip with the Markdown and an images/ folder when the page has pictures. */
async function markdownExport(page: Page): Promise<{ bytes: Uint8Array<ArrayBuffer>; ext: 'md' | 'zip' }> {
  const hidden = hiddenBlockIds(page.blocks);
  const imageBlocks = page.blocks.filter((b): b is ImageBlock => b.type === 'image' && !hidden.has(b.id));
  const ink = liveDrawing(page.drawing);
  const enc = new TextEncoder();
  if (!imageBlocks.length && !ink) return { bytes: toArrayBufferBytes(enc.encode(pageToMarkdown(page, () => ''))), ext: 'md' };

  const files: Record<string, Uint8Array> = {};
  const names = new Map<string, string>();
  for (const b of imageBlocks) {
    if (names.has(b.imageId)) continue;
    const img = await getStorage().sync.readImage(b.imageId);
    if (!img) continue;
    const name = `images/${b.imageId}.${EXT[img.mime] ?? 'png'}`;
    names.set(b.imageId, name);
    files[name] = base64ToBytes(img.data);
  }
  // The drawing goes in as an SVG file next to the pictures.
  if (ink) files['images/drawing.svg'] = enc.encode(ink.preview);
  const base = fileBase(page);
  files[`${base}.md`] = enc.encode(
    pageToMarkdown(page, (b) => names.get(b.imageId) ?? '', ink ? 'images/drawing.svg' : ''),
  );
  return { bytes: toArrayBufferBytes(zipSync(files, { level: 6 })), ext: 'zip' };
}

function toArrayBufferBytes(u: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(u.length));
  out.set(u);
  return out;
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

export function fileBase(page: Page): string {
  const t = (page.title || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.slice(0, 80) || 'Untitled';
}

const FILTERS: Record<string, { name: string; extensions: string[]; mime: string }> = {
  md: { name: 'Markdown', extensions: ['md'], mime: 'text/markdown' },
  zip: { name: 'Zip archive', extensions: ['zip'], mime: 'application/zip' },
  pdf: { name: 'PDF', extensions: ['pdf'], mime: 'application/pdf' },
  json: { name: 'Canvas Notes backup', extensions: ['json'], mime: 'application/json' },
  png: { name: 'PNG image', extensions: ['png'], mime: 'image/png' },
};

/** Asks where to save, then writes the file. Returns false if cancelled. */
export async function saveBytes(name: string, ext: string, bytes: Uint8Array<ArrayBuffer>): Promise<string | false> {
  const f = FILTERS[ext];
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
    let defaultPath = `${name}.${ext}`;
    try {
      const { downloadDir, join } = await import('@tauri-apps/api/path');
      defaultPath = await join(await downloadDir(), defaultPath);
    } catch {
      /* no Downloads folder (phones): let the picker decide */
    }
    let path: string | null;
    try {
      path = await save({ defaultPath, filters: [{ name: f.name, extensions: f.extensions }] });
    } catch (e) {
      if (String(e).toLowerCase().includes('cancel')) return false;
      throw e;
    }
    if (!path) return false;
    await writeFile(path, bytes);
    const shown = decodeURIComponent(path.split(/[\\/]/).pop() ?? `${name}.${ext}`);
    return shown.includes('.') ? shown : `${name}.${ext}`;
  }
  // Browser preview: a normal download.
  const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `${name}.${ext}`;
}

let busy = false;

export async function exportPage(pageId: string, format: ExportFormat) {
  const page = useNotes.getState().pages[pageId];
  if (!page || busy) return;
  busy = true;
  const label = format === 'markdown' ? 'Markdown' : format.toUpperCase();
  try {
    let bytes: Uint8Array<ArrayBuffer>;
    let ext: string;
    if (format === 'markdown') {
      ({ bytes, ext } = await markdownExport(page));
    } else {
      toast(`Preparing ${label}…`, undefined, 2500);
      const { canvas, width, height } = await renderPage(page);
      if (format === 'png') {
        bytes = toArrayBufferBytes(await canvasBytes(canvas, 'image/png'));
        ext = 'png';
      } else {
        const jpeg = await canvasBytes(canvas, 'image/jpeg', 0.92);
        bytes = jpegToPdf(jpeg, canvas.width, canvas.height, width, height);
        ext = 'pdf';
      }
    }
    const saved = await saveBytes(fileBase(page), ext, bytes);
    if (saved) toast(`Saved ${saved}`);
  } catch (e) {
    console.error(e);
    toast(`Couldn’t export as ${label}: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    busy = false;
  }
}

export const EXPORT_ITEMS = (pageId: string) => [
  { label: 'Markdown (.md)', action: () => void exportPage(pageId, 'markdown') },
  { label: 'PDF', action: () => void exportPage(pageId, 'pdf') },
  { label: 'PNG image', action: () => void exportPage(pageId, 'png') },
];
