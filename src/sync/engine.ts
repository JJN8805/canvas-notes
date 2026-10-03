/**
 * Wi-Fi sync between the phone (client) and the laptop (server).
 *
 * Every page and group has an `etag` that changes on each save, and remembers
 * `synced`: the etag both devices agreed on last time. Comparing those tells
 * us, per item, who changed it since the last sync:
 *
 *   only the phone   → send it (the laptop accepts only if it still has `synced`)
 *   only the laptop  → fetch it
 *   both             → conflict: the laptop's version stays, the phone's version
 *                      is kept as a "(conflicted copy)" page. Nothing is lost.
 *                      An edit always beats a deletion.
 *
 * Images never change once stored, so they're simply copied to whichever side
 * needs them for the pages it has.
 */
import type { Block } from '../types';
import { newId } from '../lib/util';
import type { GroupRecord, ImagePayload, PageRecord, SyncKind, SyncMeta, SyncRecord, SyncStore } from '../storage/types';

export const PROTOCOL_VERSION = 1;

export type SyncRequest =
  | { op: 'hello' }
  | { op: 'manifest' }
  | { op: 'get'; kind: SyncKind; ids: string[] }
  | { op: 'put'; kind: SyncKind; items: { record: SyncRecord; base: string | null }[] }
  | { op: 'getImages'; ids: string[] }
  | { op: 'putImages'; images: ImagePayload[] };

export interface Manifest {
  pages: SyncMeta[];
  groups: SyncMeta[];
  images: string[];
}

export interface SyncReport {
  sent: number;
  received: number;
  conflicts: number;
  images: number;
}

export type Send = <T>(req: SyncRequest) => Promise<T>;

const CHUNK = 40;
const IMAGE_BATCH_BYTES = 6 * 1024 * 1024;

const chunks = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

const imageIdsOf = (blocks: Block[]) => blocks.filter((b) => b.type === 'image').map((b) => (b as { imageId: string }).imageId);

/* ------------------------------------------------------------------ */
/* Laptop side                                                         */
/* ------------------------------------------------------------------ */

export interface ServerHooks {
  /** Called before reading, so unsaved edits on the laptop are included. */
  beforeRead?: () => Promise<void>;
  /** Called after the phone changed something, so the laptop UI can reload. */
  afterWrite?: () => void;
}

export async function handleRequest(store: SyncStore, req: SyncRequest, hooks: ServerHooks = {}): Promise<unknown> {
  switch (req.op) {
    case 'hello':
      return { app: 'canvas-notes', protocol: PROTOCOL_VERSION };
    case 'manifest': {
      await hooks.beforeRead?.();
      const [pages, groups, images] = await Promise.all([store.listMeta('page'), store.listMeta('group'), store.listImageIds()]);
      return { pages, groups, images } satisfies Manifest;
    }
    case 'get':
      return { records: await store.getRecords(req.kind, req.ids) };
    case 'put': {
      const accepted: string[] = [];
      const rejected: string[] = [];
      for (const { record, base } of req.items) {
        if (await store.applyRemoteIf(req.kind, record, base)) accepted.push(record.id);
        else rejected.push(record.id);
      }
      if (accepted.length) hooks.afterWrite?.();
      return { accepted, rejected };
    }
    case 'getImages': {
      const images: ImagePayload[] = [];
      for (const id of req.ids) {
        const img = await store.readImage(id);
        if (img) images.push(img);
      }
      return { images };
    }
    case 'putImages':
      for (const img of req.images) await store.writeImage(img);
      if (req.images.length) hooks.afterWrite?.();
      return { ok: true };
    default:
      throw new Error('Unknown sync request');
  }
}

/* ------------------------------------------------------------------ */
/* Phone side                                                          */
/* ------------------------------------------------------------------ */

interface Plan {
  pull: string[];
  push: { id: string; base: string | null }[];
  markSynced: { id: string; etag: string }[];
  copies: string[]; // pages to keep as a conflicted copy before pulling the laptop's version
  conflicts: number;
}

function plan(kind: SyncKind, local: SyncMeta[], remote: SyncMeta[]): Plan {
  const L = new Map(local.map((m) => [m.id, m]));
  const R = new Map(remote.map((m) => [m.id, m]));
  const p: Plan = { pull: [], push: [], markSynced: [], copies: [], conflicts: 0 };

  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id);
    const r = R.get(id);
    if (l && r && l.etag === r.etag) {
      if (l.synced !== r.etag) p.markSynced.push({ id, etag: r.etag });
      continue;
    }
    if (!l) {
      p.pull.push(id);
      continue;
    }
    if (!r) {
      // New here (or the laptop's data was reset): send it.
      p.push.push({ id, base: null });
      continue;
    }
    const localChanged = l.etag !== l.synced;
    const remoteChanged = r.etag !== l.synced;
    if (localChanged && !remoteChanged) p.push.push({ id, base: r.etag });
    else if (!localChanged && remoteChanged) p.pull.push(id);
    else {
      // Both sides changed it since the last sync.
      p.conflicts++;
      if (r.deleted && !l.deleted) p.push.push({ id, base: r.etag }); // our edit beats their deletion
      else if (l.deleted || r.deleted || kind === 'group') p.pull.push(id); // their edit beats our deletion; groups: laptop wins
      else {
        p.copies.push(id);
        p.pull.push(id);
      }
    }
  }
  return p;
}

/**
 * One full sync from the phone. Runs up to three rounds: a round can be
 * rejected for an item the laptop changed while we were syncing, and the next
 * round resolves it.
 */
export async function syncWithLaptop(store: SyncStore, send: Send): Promise<SyncReport> {
  const report: SyncReport = { sent: 0, received: 0, conflicts: 0, images: 0 };
  for (let round = 0; round < 3; round++) {
    const again = await syncRound(store, send, report);
    if (!again) break;
  }
  return report;
}

async function syncRound(store: SyncStore, send: Send, report: SyncReport): Promise<boolean> {
  const manifest = await send<Manifest>({ op: 'manifest' });
  let again = false;

  // Groups first so pages never point at a group the other side lacks.
  for (const kind of ['group', 'page'] as const) {
    const p = plan(kind, await store.listMeta(kind), kind === 'page' ? manifest.pages : manifest.groups);
    report.conflicts += p.conflicts;

    // Keep our side of a two-sided edit as a separate page.
    if (p.copies.length) {
      const mine = (await store.getRecords('page', p.copies)) as PageRecord[];
      for (const r of mine) {
        await store.insertLocalPage({
          id: newId(),
          title: `${r.title || 'Untitled'} (conflicted copy)`,
          groupId: r.groupId,
          tags: r.tags,
          blocks: r.blocks,
          created: Date.now(),
          updated: Date.now(),
        });
        again = true; // the copy is sent in the next round
      }
    }

    // Images the laptop needs for pages we're about to send, before the pages themselves.
    if (kind === 'page' && p.push.length) {
      const outgoing = (await store.getRecords('page', p.push.map((x) => x.id))) as PageRecord[];
      const have = new Set(manifest.images);
      const local = new Set(await store.listImageIds());
      const needed = [...new Set(outgoing.flatMap((r) => imageIdsOf(r.blocks)))].filter((id) => !have.has(id) && local.has(id));
      report.images += await sendImages(store, send, needed);
      needed.forEach((id) => have.add(id));
    }

    // Fetch.
    for (const ids of chunks(p.pull, CHUNK)) {
      const { records } = await send<{ records: SyncRecord[] }>({ op: 'get', kind, ids });
      for (const rec of records) await store.applyRemote(kind, rec);
      report.received += records.length;
    }

    // Send.
    const bases = new Map(p.push.map((x) => [x.id, x.base]));
    for (const ids of chunks(p.push.map((x) => x.id), CHUNK)) {
      const records = await store.getRecords(kind, ids);
      const res = await send<{ accepted: string[]; rejected: string[] }>({
        op: 'put',
        kind,
        items: records.map((record) => ({ record, base: bases.get(record.id) ?? null })),
      });
      const etags = new Map(records.map((r) => [r.id, r.etag]));
      for (const id of res.accepted) await store.markSynced(kind, id, etags.get(id)!);
      report.sent += res.accepted.length;
      if (res.rejected.length) again = true;
    }

    for (const m of p.markSynced) await store.markSynced(kind, m.id, m.etag);
  }

  // Images our pages show but we don't have yet (e.g. pages just fetched).
  const pages = (await store.getRecords('page', (await store.listMeta('page')).filter((m) => !m.deleted).map((m) => m.id))) as PageRecord[];
  const local = new Set(await store.listImageIds());
  const onLaptop = new Set(manifest.images);
  const missing = [...new Set(pages.flatMap((r) => imageIdsOf(r.blocks)))].filter((id) => !local.has(id) && onLaptop.has(id));
  for (const ids of chunks(missing, 4)) {
    const { images } = await send<{ images: ImagePayload[] }>({ op: 'getImages', ids });
    for (const img of images) await store.writeImage(img);
    report.images += images.length;
  }

  return again;
}

async function sendImages(store: SyncStore, send: Send, ids: string[]): Promise<number> {
  let batch: ImagePayload[] = [];
  let size = 0;
  let sent = 0;
  const flush = async () => {
    if (!batch.length) return;
    await send({ op: 'putImages', images: batch });
    sent += batch.length;
    batch = [];
    size = 0;
  };
  for (const id of ids) {
    const img = await store.readImage(id);
    if (!img) continue;
    if (size + img.data.length > IMAGE_BATCH_BYTES) await flush();
    batch.push(img);
    size += img.data.length;
  }
  await flush();
  return sent;
}

export type { GroupRecord, PageRecord };
