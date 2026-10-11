import type { GraphDb } from './db';
import { GraphMirror, type LegacyGroup, type LegacyPage } from './mirror';
import { GraphRepo } from './repo';

export interface GraphHost {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
  /** "Laptop", "Phone"… shown in the devices table. */
  deviceName: string;
  /** Saves a copy of the existing data. If it throws, nothing is imported. */
  backup(): Promise<void>;
  /** Everything currently stored in the page tables (live rows only), with etags. */
  loadLegacy(): Promise<{ pages: LegacyPage[]; groups: LegacyGroup[] }>;
  loadGroups(): Promise<LegacyGroup[]>;
  /** The etag of every live page, to spot pages the graph has not caught up with. */
  listEtags(): Promise<{ id: string; etag: string }[]>;
  loadPages(ids: string[]): Promise<LegacyPage[]>;
}

const DEVICE_KEY = 'graph_device_id';
const IMPORTED_KEY = 'graph_imported_at';

/**
 * Opens the graph layer on an already-migrated database:
 *  1. gives this install a device id (once) and records it in `devices`,
 *  2. on the very first run, backs up the existing data and imports it,
 *  3. on later runs, re-projects any page whose graph copy is out of date.
 * The import is idempotent and the flag is set last, so an interrupted one simply reruns.
 */
export async function openGraph(db: GraphDb, host: GraphHost, now: () => number = Date.now): Promise<GraphMirror> {
  let deviceId = await host.getSetting(DEVICE_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await host.setSetting(DEVICE_KEY, deviceId);
  }
  const repo = new GraphRepo(db, deviceId, now);
  await repo.ensureDevice(deviceId, host.deviceName);
  const mirror = new GraphMirror(repo);

  if (!(await host.getSetting(IMPORTED_KEY))) {
    await host.backup();
    await mirror.importAll(await host.loadLegacy());
    await host.setSetting(IMPORTED_KEY, String(now()));
  } else {
    await mirror.groups(await host.loadGroups()); // few rows, so always refreshed
    const current = await host.listEtags();
    const stale = await mirror.staleIds(current);
    if (stale.length) for (const p of await host.loadPages(stale)) await mirror.page(p);
    // Pages deleted while the graph wasn't looking.
    const live = new Set(current.map((c) => c.id));
    for (const n of await repo.listNodes('page')) if (!live.has(n.id)) await mirror.removePage(n.id);
  }
  return mirror;
}
