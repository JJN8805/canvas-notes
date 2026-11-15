/**
 * A safety copy of the notes database, made the first time a new version of the app opens it (before it reads, converts or
 * changes anything). If the new version turns out to be wrong for you, the copy is the old state to go back to.
 *
 * The decision and the bookkeeping are here and use only a tiny file-system interface, so they are tested without a window.
 * Where the copies are kept: `backups/pre-<version>-<date>-<time>/` in the app's own folder; the newest three are kept.
 */
export interface CopyFs {
  /** The file's bytes, or null when it does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Removes a file or a folder with everything in it. */
  remove(path: string): Promise<void>;
}

export interface CopyState {
  /** The app version that last opened the database. */
  version: string;
  /** Folders (inside `backups/`) holding earlier copies, oldest first. */
  copies: string[];
}

export const KEEP = 3;
export const STATE_FILE = 'backups/state.json';
export const DB_FILES = ['canvas-notes.db', 'canvas-notes.db-wal'] as const;
const FOLDER = /^pre-[\w.+-]{1,40}-\d{8}-\d{6}$/;

/** The stored state, or null when it is missing or not what this code wrote (a folder name that is not ours is never trusted). */
export function parseState(text: string | null): CopyState | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<CopyState>;
    if (typeof v.version !== 'string' || !Array.isArray(v.copies)) return null;
    return { version: v.version.slice(0, 40), copies: v.copies.filter((c): c is string => typeof c === 'string' && FOLDER.test(c)) };
  } catch {
    return null;
  }
}

export const folderName = (version: string, now: number): string => {
  const d = new Date(now);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const safe = version.replace(/[^\w.+-]/g, '_').slice(0, 40) || 'unknown';
  return `pre-${safe}-${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
};

export interface CopyResult {
  /** The folder made, or null when nothing was copied (same version as last time, or there was no database yet). */
  made: string | null;
  removed: string[];
}

export async function copyBeforeUpgrade(fs: CopyFs, version: string, now = Date.now()): Promise<CopyResult> {
  const enc = new TextEncoder();
  const state = parseState(await readText(fs, STATE_FILE));
  if (state && state.version === version) return { made: null, removed: [] };

  const files: { name: string; bytes: Uint8Array }[] = [];
  for (const name of DB_FILES) {
    const bytes = await fs.read(name);
    if (bytes) files.push({ name, bytes });
  }
  const copies = state?.copies ?? [];
  let made: string | null = null;
  // No database yet = a first start: there is nothing to keep, only the version to remember.
  if (files.some((f) => f.name === 'canvas-notes.db')) {
    made = folderName(version, now);
    await fs.mkdir('backups');
    await fs.mkdir(`backups/${made}`);
    for (const f of files) await fs.write(`backups/${made}/${f.name}`, f.bytes);
    copies.push(made);
  }
  const removed = copies.splice(0, Math.max(0, copies.length - KEEP));
  for (const old of removed) await fs.remove(`backups/${old}`);
  await fs.mkdir('backups');
  await fs.write(STATE_FILE, enc.encode(JSON.stringify({ version, copies } satisfies CopyState)));
  return { made, removed };
}

async function readText(fs: CopyFs, path: string): Promise<string | null> {
  const b = await fs.read(path);
  return b ? new TextDecoder().decode(b) : null;
}
