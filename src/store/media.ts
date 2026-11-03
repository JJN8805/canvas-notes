/** Adding audio clips and PDFs to a page. The bytes go in the same file store as pictures, so they sync, back up and clean up the same way. */
import { addBlock, getStorage } from './notes';
import { AUDIO_H } from './notes/blocks';
import { toast } from './ui';
import { addImages } from './images';
import { kindOfFile, mediaProblem, mimeOf, nameFromFile } from '../lib/media';
import { openPdfBytes } from '../lib/pdf';

type At = { x: number; y: number };

/** The same bytes with a clean content type, which the file store needs to keep and later send it. */
const asTyped = (file: Blob & { name?: string }) => new Blob([file], { type: mimeOf(file as { type: string; name?: string }) });

/** How long a clip is, in seconds, or undefined when the webview can't tell (it never fails the add). */
function audioLength(blob: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    const done = (v?: number) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(), 4000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration)) return done(Math.round(a.duration));
      // A fresh recording has no length in its header (the webview says Infinity). Seeking far past the end makes it scan to the real end.
      a.ondurationchange = () => Number.isFinite(a.duration) && done(Math.round(a.duration));
      a.currentTime = 1e101;
    };
    a.onerror = () => done();
    a.src = url;
  });
}

/** Adds one audio file (or a finished recording) as an audio box. Returns the block id, or '' with a message shown. */
export async function addAudio(pageId: string, file: File | Blob, at: At, name?: string): Promise<string> {
  const label = name ?? ('name' in file ? nameFromFile((file as File).name, 'Audio') : 'Audio');
  const problem = mediaProblem({ type: file.type, name: (file as File).name, size: file.size }, 'audio');
  if (problem) {
    toast(`Couldn’t add ${label}: ${problem}.`);
    return '';
  }
  try {
    const blob = asTyped(file as File);
    const duration = await audioLength(blob);
    const fileId = await getStorage().putImage(blob);
    return addBlock(pageId, 'audio', at, { fileId, name: label, duration, w: 320, h: AUDIO_H });
  } catch (e) {
    toast(`Couldn’t add ${label}: ${e instanceof Error ? e.message : 'unknown error'}.`);
    return '';
  }
}

/** Adds one PDF as a box sized to its first page. */
export async function addPdf(pageId: string, file: File, at: At): Promise<string> {
  const label = nameFromFile(file.name, 'PDF');
  const problem = mediaProblem(file, 'pdf');
  if (problem) {
    toast(`Couldn’t add ${label}: ${problem}.`);
    return '';
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openPdfBytes(bytes); // also proves it is a real, readable PDF before it is stored
    const first = await doc.getPage(1);
    const v = first.getViewport({ scale: 1 });
    const pages = doc.numPages;
    void doc.loadingTask.destroy();
    const w = 360;
    const h = Math.max(220, Math.min(720, Math.round((w * v.height) / v.width) + PDF_BAR_H));
    const fileId = await getStorage().putImage(asTyped(file));
    return addBlock(pageId, 'pdf', at, { fileId, name: label, pages, w, h });
  } catch (e) {
    toast(`Couldn’t add ${label}: ${e instanceof Error ? e.message : 'unknown error'}.`);
    return '';
  }
}

/** Height of the bar under a PDF page (previous, next, page count). */
export const PDF_BAR_H = 36;

/** Places whatever mix of pictures, audio and PDFs was chosen or dropped, cascading from `at`. Returns the new block ids. */
export async function addMediaFiles(pageId: string, files: File[], at: At): Promise<string[]> {
  const images = files.filter((f) => kindOfFile(f) === 'image');
  const others = files.filter((f) => kindOfFile(f) === 'audio' || kindOfFile(f) === 'pdf');
  const skipped = files.length - images.length - others.length;
  if (skipped && !images.length && !others.length) {
    toast('Only pictures, audio and PDF files can be placed on a page.');
    return [];
  }
  if (skipped) toast(`${skipped} file${skipped === 1 ? ' was' : 's were'} skipped: only pictures, audio and PDFs can be placed on a page.`);
  const ids: string[] = [];
  if (images.length) ids.push(...(await addImages(pageId, images, at)));
  for (let i = 0; i < others.length; i++) {
    const f = others[i];
    const spot = { x: at.x + (images.length + i) * 24, y: at.y + (images.length + i) * 24 };
    const id = kindOfFile(f) === 'pdf' ? await addPdf(pageId, f, spot) : await addAudio(pageId, f, spot);
    if (id) ids.push(id);
  }
  return ids;
}
