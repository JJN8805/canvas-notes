/**
 * Checks for data that arrives from outside the app (a sync peer, a backup file) before it is
 * used to build a file name or stored. Storage backends call these; they stay free of I/O.
 */

/** Image formats the app stores and the file extension each one gets. */
export const IMAGE_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

/** Audio and PDF files, stored in the same place as pictures. Codec parameters ("audio/webm;codecs=opus") are stripped before lookup. */
export const MEDIA_EXT: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'audio/flac': 'flac',
};

/** Everything the file store accepts: pictures, audio and PDFs. */
export const FILE_EXT: Readonly<Record<string, string>> = { ...IMAGE_EXT, ...MEDIA_EXT };

/** Ids the app makes are letters and digits (base 36); allow `-` and `_` too, but never a path separator or dot. */
export const isSafeId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);

export const isKnownImageType = (mime: unknown): mime is string => typeof mime === 'string' && Object.prototype.hasOwnProperty.call(IMAGE_EXT, mime);

export const isKnownFileType = (mime: unknown): mime is string => typeof mime === 'string' && Object.prototype.hasOwnProperty.call(FILE_EXT, mime);

/** Throws unless an incoming stored file (picture, audio or PDF) has a safe id and a known type. */
export function assertSafeImage(img: { id: unknown; mime: unknown }): void {
  if (!isSafeId(img.id)) throw new Error('Rejected a file with an unsafe id.');
  if (!isKnownFileType(img.mime)) throw new Error('Rejected a file of an unsupported type.');
}
