import { getStorage, useNotes } from './notes';
import { toast } from './ui';
import { buildBackup } from '../lib/backup';
import { backupToZip } from '../lib/archiveZip';
import { archiveName, isDue, parseAuto, toRemove, type AutoArchive } from '../lib/autoArchive';

/**
 * Automatic archive files (desktop only): a dated .zip of everything, kept in the app's own folder (`archives/`), the newest few kept.
 * The names of the files made are remembered in the settings (not read back from the folder), so nothing but those is ever removed.
 */
const DIR = 'archives';
const CFG = 'archive.auto';
const LAST = 'archive.last';
const FILES = 'archive.files';

/** The laptop app (not a browser, not the phone: there a hidden folder in the app's private storage would be no use). */
export const autoArchiveAvailable = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && !/Android/i.test(navigator.userAgent);

export interface AutoState {
  cfg: AutoArchive;
  last: number | null;
  files: string[];
}

export async function loadAutoState(): Promise<AutoState> {
  const s = getStorage();
  const [cfg, last, files] = await Promise.all([s.getSetting(CFG), s.getSetting(LAST), s.getSetting(FILES)]);
  let names: string[] = [];
  try {
    const v: unknown = JSON.parse(files ?? '[]');
    names = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    /* none */
  }
  return { cfg: parseAuto(cfg), last: last && Number.isFinite(Number(last)) ? Number(last) : null, files: names };
}

export async function saveAutoConfig(cfg: AutoArchive): Promise<void> {
  await getStorage().setSetting(CFG, JSON.stringify(cfg));
}

/** The folder the archive files go to, to show the person. */
export async function archiveFolder(): Promise<string> {
  const { appConfigDir, join } = await import('@tauri-apps/api/path');
  return join(await appConfigDir(), DIR);
}

/** Make an archive now (when `force`, or when one is due). Returns the file name, or null when nothing was made. Never throws into the UI. */
export async function runAutoArchive(force = false): Promise<string | null> {
  if (!autoArchiveAvailable()) return null;
  try {
    const state = await loadAutoState();
    const now = Date.now();
    if (!force && !isDue(state.cfg, state.last, now)) return null;
    const { BaseDirectory, mkdir, remove, writeFile } = await import('@tauri-apps/plugin-fs');
    const opts = { baseDir: BaseDirectory.AppConfig };
    await mkdir(DIR, { ...opts, recursive: true });
    const name = archiveName(new Date(now), state.files);
    await writeFile(`${DIR}/${name}`, backupToZip(await buildBackup(getStorage(), now)), opts);
    let files = [...state.files, name];
    for (const old of toRemove(files, state.cfg.keep)) {
      await remove(`${DIR}/${old}`, opts).catch(() => {});
      files = files.filter((f) => f !== old);
    }
    const s = getStorage();
    await s.setSetting(LAST, String(now));
    await s.setSetting(FILES, JSON.stringify(files));
    return name;
  } catch (e) {
    console.warn('Automatic archive failed', e);
    if (force) toast(`The archive couldn’t be saved: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

const REMINDED = 'archive.reminded';
/**
 * Once, a while after start: if the automatic archive is off and there is something worth keeping (more than one workspace, or a good few
 * pages), offer to turn it on. Asked once only (saved), and never on a phone or in a browser.
 */
export async function remindAboutArchive(pageCount: number, workspaceCount: number): Promise<void> {
  if (!autoArchiveAvailable() || (workspaceCount < 2 && pageCount < 20)) return;
  const s = getStorage();
  if ((await s.getSetting(REMINDED).catch(() => null)) === '1') return;
  if (parseAuto(await s.getSetting(CFG).catch(() => null)).mode !== 'off') return;
  await s.setSetting(REMINDED, '1').catch(() => {});
  toast(
    'Your notes are only on your devices. Make a dated archive file every week?',
    { label: 'Turn on', run: () => void saveAutoConfig({ mode: 'weekly', keep: 4 }).then(() => toast('A weekly archive will be saved in the app’s folder (Settings → Data shows where).')) },
    14000,
  );
}

let started = false;
/** Check shortly after start and then every few hours, so a laptop that stays on still gets its daily or weekly archive. */
export function startAutoArchive() {
  if (started || !autoArchiveAvailable()) return;
  started = true;
  window.setTimeout(() => void runAutoArchive(), 60_000);
  window.setTimeout(() => {
    const st = useNotes.getState();
    void remindAboutArchive(Object.keys(st.pages).length + st.elsewhere.length, st.workspaces.length + 1);
  }, 90_000);
  window.setInterval(() => void runAutoArchive(), 6 * 3_600_000);
}
