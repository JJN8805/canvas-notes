/** Audio and PDF files: telling what a file is, limits, and how to show sizes and times. Pure, so it is tested without a browser. */
import { FILE_EXT, MEDIA_EXT, VIDEO_EXT } from '../storage/validate';

export type FileKind = 'image' | 'audio' | 'pdf' | 'video';

/** The most one video may weigh: it is kept on every device and sent whole when syncing. */
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
/** The most an animated GIF may weigh (GIFs get big fast). Other pictures are resized, not limited. */
export const MAX_GIF_BYTES = 25 * 1024 * 1024;

const VIDEO_EXT_TO_MIME: Readonly<Record<string, string>> = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg' };

/** The type of a chosen video file (its own, or from its extension when the type is empty), or '' when it is not a video the app keeps. */
export function videoMimeOf(file: { type: string; name?: string }): string {
  const t = file.type.split(';')[0].trim().toLowerCase();
  if (t === 'video/x-m4v') return 'video/mp4';
  if (t.startsWith('video/')) return Object.prototype.hasOwnProperty.call(VIDEO_EXT, t) ? t : '';
  if (t) return ''; // some other kind of file
  const ext = file.name?.match(/\.([A-Za-z0-9]+)$/)?.[1].toLowerCase();
  return (ext && VIDEO_EXT_TO_MIME[ext]) || '';
}

/** Whether a chosen file is a video the app keeps. */
export const isVideoFile = (file: { type: string; name?: string }): boolean => videoMimeOf(file) !== '';

/** Why a file can't be a card's picture, in words for the user, or null when it's fine. Pictures, GIFs and videos are accepted. */
export function coverProblem(file: { type: string; name?: string; size: number }): string | null {
  if (file.size === 0) return 'the file is empty';
  if (isVideoFile(file)) return file.size > MAX_VIDEO_BYTES ? `the video is ${formatSize(file.size)}; the limit is ${formatSize(MAX_VIDEO_BYTES)}` : null;
  if (file.type.startsWith('video/')) return 'that video format can’t be kept (use MP4, WebM, MOV or OGG)';
  if (!file.type.startsWith('image/')) return 'choose a picture, a GIF or a video';
  if (file.type === 'image/gif' && file.size > MAX_GIF_BYTES) return `the GIF is ${formatSize(file.size)}; the limit is ${formatSize(MAX_GIF_BYTES)}`;
  return null;
}

/** The most one audio or PDF file may weigh: it is kept on every device and sent whole when syncing. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

const EXT_TO_MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  weba: 'audio/webm',
  webm: 'audio/webm',
  flac: 'audio/flac',
};

/** A file's type without codec parameters ("audio/webm;codecs=opus" -> "audio/webm"), using its extension when the type is empty (common for dragged-in files). */
export function mimeOf(file: { type: string; name?: string }): string {
  const t = file.type.split(';')[0].trim().toLowerCase();
  if (t === 'audio/x-wav' || t === 'audio/wave') return 'audio/wav';
  if (t === 'audio/x-m4a') return 'audio/mp4';
  if (t === 'audio/mp3') return 'audio/mpeg';
  if (t) return t;
  const ext = file.name?.match(/\.([A-Za-z0-9]+)$/)?.[1].toLowerCase();
  return (ext && EXT_TO_MIME[ext]) || '';
}

/** What the app does with a dropped or chosen file, or null when it can't be placed on a page. */
export function kindOfFile(file: { type: string; name?: string }): FileKind | null {
  // A file that says it is a video is one (an extension alone can't tell a .mp4 video from a .mp4 audio file).
  if (file.type.split(';')[0].trim().toLowerCase().startsWith('video/') && isVideoFile(file)) return 'video';
  const m = mimeOf(file);
  if (m === 'application/pdf') return 'pdf';
  if (Object.prototype.hasOwnProperty.call(MEDIA_EXT, m)) return 'audio';
  if (m.startsWith('image/')) return 'image';
  return null;
}

/** Why a file can't be added, in words for the user, or null when it's fine. */
export function mediaProblem(file: { type: string; name?: string; size: number }, kind: 'audio' | 'pdf'): string | null {
  const m = mimeOf(file);
  if (!Object.prototype.hasOwnProperty.call(FILE_EXT, m) || kindOfFile(file) !== kind) return kind === 'pdf' ? 'that isn’t a PDF' : 'that isn’t an audio format the app can keep (MP3, M4A, AAC, OGG, WAV, WebM or FLAC)';
  if (file.size === 0) return 'the file is empty';
  if (file.size > MAX_MEDIA_BYTES) return `it is ${formatSize(file.size)}; the limit is ${formatSize(MAX_MEDIA_BYTES)}`;
  return null;
}

/** "m:ss", or "h:mm:ss" for long ones. Anything not a finite non-negative number reads as "0:00". */
export function formatDuration(seconds: unknown): string {
  const s = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** A readable name for a clip or document from its file name: no extension, underscores as spaces. */
export function nameFromFile(fileName: string, fallback: string): string {
  const n = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  return (n || fallback).slice(0, 120);
}

/** A page number held to 1..pages (pages unknown = at least 1). Non-numbers become 1. */
export function clampPage(page: unknown, pages: number | undefined): number {
  const p = typeof page === 'number' && Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.max(1, pages && pages > 0 ? Math.min(p, pages) : p);
}
