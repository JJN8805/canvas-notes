/**
 * The archive file: everything in the library as ONE .zip you keep. Unlike the .json backup (which writes pictures, audio and video as
 * base64 text inside one big file), the zip holds each file as a normal file, so you can open them without the app, and big videos do
 * not blow up in size. Pure (bytes in, bytes out): the app saves and reads the file elsewhere.
 *
 *   canvas-notes-archive.json   the pages and groups, and a list of the files (id, type, name in files/)
 *   files/<id>.<ext>            every picture, GIF, video, audio clip and PDF the pages use
 *   README.txt                  what this is
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { bytesToBase64, base64ToBytes } from '../storage/types';
import { FILE_EXT, isKnownFileType, isSafeId } from '../storage/validate';
import { cleanBackup, type Backup } from './backup';

export const ARCHIVE_FORMAT = 'canvas-notes-archive';
const MANIFEST = 'canvas-notes-archive.json';
/** The most an archive may unpack to: it is read into memory, so a hostile file can't make the app run out of it. */
export const MAX_UNPACKED_BYTES = 1.5 * 1024 * 1024 * 1024;

interface Manifest {
  format: typeof ARCHIVE_FORMAT;
  version: 1;
  exported: number;
  counts: { pages: number; groups: number; files: number };
  backup: Omit<Backup, 'images'>;
  files: { id: string; mime: string; name: string }[];
}

const README = `This is a Canvas Notes archive.

canvas-notes-archive.json  your pages and groups, and a list of the files
files/                     every picture, GIF, video, audio clip and PDF your pages use, as normal files

To put it back: Canvas Notes > Settings > Data > Restore from backup, and choose this .zip.
Anything you already have is left as it is.
`;

/** Pack a backup into a zip. Files are stored as they are (already compressed), the text is compressed. */
export function backupToZip(backup: Backup): Uint8Array<ArrayBuffer> {
  const entries: Zippable = {};
  const files: Manifest['files'] = [];
  for (const img of backup.images) {
    const name = `files/${img.id}.${FILE_EXT[img.mime] ?? 'bin'}`;
    entries[name] = [base64ToBytes(img.data), { level: 0 }];
    files.push({ id: img.id, mime: img.mime, name });
  }
  const { images: _images, ...rest } = backup;
  void _images;
  const manifest: Manifest = { format: ARCHIVE_FORMAT, version: 1, exported: backup.exported, counts: { pages: backup.pages.length, groups: backup.groups.length, files: files.length }, backup: rest, files };
  entries[MANIFEST] = new TextEncoder().encode(JSON.stringify(manifest));
  entries['README.txt'] = new TextEncoder().encode(README);
  return zipSync(entries) as Uint8Array<ArrayBuffer>;
}

/** Whether these bytes are a zip file (they start with "PK"). */
export const isZip = (bytes: Uint8Array): boolean => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);

/** Unpack an archive into a backup. Throws a message fit to show when it is not one of ours, or is too big. */
export function zipToBackup(bytes: Uint8Array): Backup {
  let seen = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        seen += f.originalSize;
        if (seen > MAX_UNPACKED_BYTES) throw new Error('too big');
        return f.name === MANIFEST || f.name.startsWith('files/');
      },
    });
  } catch (e) {
    throw new Error(e instanceof Error && e.message === 'too big' ? 'That archive is too big to open here.' : 'That file isn’t a Canvas Notes archive.');
  }
  const raw = entries[MANIFEST];
  if (!raw) throw new Error('That zip isn’t a Canvas Notes archive.');
  let manifest: Partial<Manifest>;
  try {
    manifest = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error('That zip isn’t a Canvas Notes archive.');
  }
  if (!manifest || manifest.format !== ARCHIVE_FORMAT || !manifest.backup) throw new Error('That zip isn’t a Canvas Notes archive.');
  if (manifest.version !== 1) throw new Error('That archive was made by a newer version of Canvas Notes. Update the app and try again.');
  const images = [] as Backup['images'];
  for (const f of Array.isArray(manifest.files) ? manifest.files : []) {
    // Only files the list names, with safe ids and known types, are read; a name in the list is looked up, never used as a path.
    if (!f || !isSafeId(f.id) || !isKnownFileType(f.mime) || typeof f.name !== 'string') continue;
    const data = entries[f.name];
    if (data && f.name.startsWith('files/')) images.push({ id: f.id, mime: f.mime, data: bytesToBase64(data) });
  }
  return cleanBackup({ ...manifest.backup, images, format: 'canvas-notes-backup', version: 1 } as Partial<Backup>);
}
