/**
 * PDF reading, through Mozilla's pdf.js. The webview can't show a PDF by itself (WebKitGTK has no viewer),
 * so pages are drawn onto a canvas. The library is big, so it is only loaded the first time a PDF is used.
 * The legacy build is used because it runs on older webviews (older WebKitGTK and Android System WebView).
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { base64ToBytes } from '../storage/types';
import { getStorage } from '../store/notes';

let pdfjs: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

export function loadPdfjs() {
  pdfjs ??= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  // A failed load (offline dev server, blocked worker) must be retried next time, not cached.
  pdfjs.catch(() => (pdfjs = null));
  return pdfjs;
}

/** Opens PDF bytes. Rejects with a message fit to show when the file isn't a readable PDF. */
export async function openPdfBytes(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const lib = await loadPdfjs();
  try {
    // pdf.js takes ownership of the buffer it is given, so hand it a copy.
    return await lib.getDocument({ data: bytes.slice(), enableXfa: false }).promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') throw new Error('this PDF is password-protected');
    throw new Error('this file can’t be read as a PDF');
  }
}

// The few most recently opened documents, so flipping pages (or several boxes showing one file) reads it once.
const open = new Map<string, Promise<PDFDocumentProxy>>();
const KEEP = 3;

/** The stored PDF with this id. */
export function pdfDocument(fileId: string): Promise<PDFDocumentProxy> {
  let doc = open.get(fileId);
  if (doc) {
    open.delete(fileId); // move to the end: most recently used
  } else {
    doc = (async () => {
      const file = await getStorage().sync.readImage(fileId);
      if (!file) throw new Error('PDF not found');
      return openPdfBytes(base64ToBytes(file.data));
    })();
    doc.catch(() => open.delete(fileId));
  }
  open.set(fileId, doc);
  while (open.size > KEEP) {
    const oldest = open.keys().next().value as string;
    const gone = open.get(oldest);
    open.delete(oldest);
    void gone?.then((d) => d.loadingTask.destroy()).catch(() => {});
  }
  return doc;
}
