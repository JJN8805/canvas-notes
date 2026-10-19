/** Rules for page history (snapshots kept on this device) and the Trash. */

export const SNAPSHOT_EVERY = 60 * 60 * 1000;
/** Snapshots newer than this are all kept; older ones are thinned to one per day. */
export const HOURLY_KEEP = 48 * 60 * 60 * 1000;
export const HISTORY_DAYS = 30;
export const TRASH_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** True when no snapshot exists yet or the newest one is at least an hour old. */
export function shouldSnapshot(lastTaken: number | null, now: number): boolean {
  return lastTaken === null || now - lastTaken >= SNAPSHOT_EVERY;
}

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Ids to delete: everything past 30 days, and all but the newest snapshot of each day once older than 48 hours. */
export function snapshotsToDrop(list: { id: string; taken: number }[], now: number): string[] {
  const drop: string[] = [];
  const newestOfDay = new Map<string, { id: string; taken: number }>();
  for (const s of list) {
    if (now - s.taken > HISTORY_DAYS * DAY) {
      drop.push(s.id);
    } else if (now - s.taken > HOURLY_KEEP) {
      const k = dayKey(s.taken);
      const cur = newestOfDay.get(k);
      if (!cur) newestOfDay.set(k, s);
      else if (s.taken > cur.taken) {
        drop.push(cur.id);
        newestOfDay.set(k, s);
      } else drop.push(s.id);
    }
  }
  return drop;
}

/** A page with nothing in it: a deleted one like this is a purged tombstone (nothing left to restore). */
export function isBlankPage(p: { title: string; tags: unknown[]; blocks: unknown[]; arrows?: unknown[]; drawing?: unknown }): boolean {
  return p.title === '' && p.tags.length === 0 && p.blocks.length === 0 && (p.arrows?.length ?? 0) === 0 && !p.drawing;
}

/** Whole days until a page deleted at `deletedAt` is purged (never below 0). */
export function daysLeft(deletedAt: number, now: number): number {
  return Math.max(0, Math.ceil(TRASH_DAYS - (now - deletedAt) / DAY));
}
