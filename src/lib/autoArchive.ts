/** Rules for the automatic archive file (pure): when one is due, what it is called, and which old ones to remove. */
export type AutoMode = 'off' | 'daily' | 'weekly';
export interface AutoArchive {
  mode: AutoMode;
  /** How many archive files to keep (the newest). */
  keep: number;
}

export const DEFAULT_AUTO: AutoArchive = { mode: 'off', keep: 4 };
const HOUR = 3_600_000;
export const INTERVAL: Record<Exclude<AutoMode, 'off'>, number> = { daily: 24 * HOUR, weekly: 7 * 24 * HOUR };

/** The saved choice, repaired: anything unreadable is "off" with the default count, and the count stays between 1 and 30. */
export function parseAuto(raw: string | null | undefined): AutoArchive {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<AutoArchive> | null;
    const mode: AutoMode = v?.mode === 'daily' || v?.mode === 'weekly' ? v.mode : 'off';
    const keep = typeof v?.keep === 'number' && Number.isFinite(v.keep) ? Math.max(1, Math.min(30, Math.round(v.keep))) : DEFAULT_AUTO.keep;
    return { mode, keep };
  } catch {
    return { ...DEFAULT_AUTO };
  }
}

/** Whether a new archive should be made now: switched on, and none yet or the last one is older than the interval. */
export const isDue = (cfg: AutoArchive, lastAt: number | null, now: number): boolean => cfg.mode !== 'off' && (lastAt === null || !Number.isFinite(lastAt) || now - lastAt >= INTERVAL[cfg.mode]);

const two = (n: number) => String(n).padStart(2, '0');
/** `canvas-notes-archive-2026-11-18.zip` (the date on this computer; a second one the same day gets -2, -3…). */
export function archiveName(date: Date, existing: readonly string[] = []): string {
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  let name = `canvas-notes-archive-${day}.zip`;
  for (let n = 2; existing.includes(name); n++) name = `canvas-notes-archive-${day}-${n}.zip`;
  return name;
}

export const isArchiveName = (n: string): boolean => /^canvas-notes-archive-\d{4}-\d{2}-\d{2}(-\d+)?\.zip$/.test(n);

/** The archive files to remove so that only the newest `keep` stay (other files in the folder are never touched). */
export const toRemove = (names: readonly string[], keep: number): string[] =>
  names
    .filter(isArchiveName)
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    .slice(Math.max(1, keep));
