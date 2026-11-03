import { Arrow, Block, Page } from '../../types';
import { seedBuiltinTemplates } from '../../lib/builtinTemplates';
import { loadPrefs, usePrefs } from '../prefs';
import { loadAddons } from '../../addons/store';
import { deepClone } from '../../lib/util';
import { fileIdsOf } from '../../lib/files';
import { isTauri, openStorage } from '../../storage';
import { toast } from '../ui';
import { Snapshot } from '../../storage/types';
import type { Draft } from 'immer';
import { get, getStorage, set, setStorage } from './state';
import { flushAll, flushPage, markDirty, refreshFromDisk } from './save';
import { mutatePage } from './mutate';
import { resolveDailyDuplicates } from './pages';

/* ------------------------------------------------------------------ */
/* Startup                                                             */
/* ------------------------------------------------------------------ */

let initPromise: Promise<void> | null = null;

export function initNotes(): Promise<void> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

export async function doInit() {
  try {
    const storage = await openStorage();
    setStorage(storage);
    // The starter templates are added once, before anything is read.
    await seedBuiltinTemplates(storage).catch((e) => console.warn('Starter templates failed', e));
    const { pages, groups } = await storage.loadAll();
    const location = await storage.location().catch(() => '');
    let collapsed: string[] = [];
    try {
      collapsed = JSON.parse((await storage.getSetting('ui.collapsedGroups')) ?? '[]');
    } catch {
      /* ignore */
    }
    await loadPrefs(storage);
    void loadAddons(storage); // add-ons that are switched on start in the background; the app does not wait for them
    set((s) => {
      s.pages = Object.fromEntries(pages.map((p) => [p.id, p]));
      s.groups = groups;
      s.storageKind = storage.kind;
      s.storageLocation = location;
      s.collapsed = Array.isArray(collapsed) ? collapsed : [];
      s.status = 'ready';
    });
    // Pages deleted longer ago than the Trash setting allows (30 days unless changed) are emptied for good (their deletion still syncs).
    await storage.purgeExpiredTrash(Date.now() - usePrefs.getState().trashDays * 24 * 3600_000).catch((e) => console.warn('Trash cleanup failed', e));
    await loadTrash();
    // Images deleted from pages are kept until the next launch so undo can bring them back.
    storage.pruneImages(usedImageIds(pages)).catch((e) => console.warn('Image cleanup failed', e));

    window.addEventListener('focus', () => void refreshFromDisk());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushAll();
    });
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      // Finish pending writes before the window closes.
      await getCurrentWindow().onCloseRequested(async () => {
        await flushAll();
      });
    }
  } catch (e) {
    console.error(e);
    set((s) => {
      s.status = 'failed';
      s.error = e instanceof Error ? e.message : String(e);
    });
  }
}

/** Re-reads the Trash list from storage. */
export async function loadTrash() {
  try {
    const trash = await getStorage().listTrash();
    set((s) => {
      s.trash = trash;
    });
  } catch (e) {
    console.warn('Could not read the Trash', e);
  }
}

/** Puts a trashed page back, the same way the delete toast's Undo does. */
export function restoreFromTrash(id: string) {
  const page = get().trash.find((p) => p.id === id);
  if (!page) return;
  set((s) => {
    s.pages[id] = { ...deepClone(page), rev: 0, updated: Date.now() };
    s.trash = s.trash.filter((p) => p.id !== id);
  });
  markDirty(id);
  resolveDailyDuplicates(); // a restored daily page may clash with one made since
  toast(`Restored “${page.title || 'Untitled'}”`);
}

/** Empties a trashed page for good. */
export async function deleteForever(id: string) {
  try {
    await getStorage().purgePage(id);
  } catch (e) {
    console.error(e);
  }
  await loadTrash();
}

/** Replaces the page's boxes and arrows with an earlier version. Undo (Ctrl+Z) brings the current ones back. */
export async function restoreSnapshot(pageId: string, snap: Snapshot) {
  await flushPage(pageId);
  // Keep what is there now too, so this stays reversible after undo history is gone.
  await getStorage().snapshotPage(pageId, { force: true }).catch((e) => console.warn('History snapshot failed', e));
  mutatePage(pageId, (p) => {
    p.blocks = deepClone(snap.blocks) as Draft<Block>[];
    p.arrows = deepClone(snap.arrows) as Draft<Arrow>[];
  });
  toast('Restored an earlier version. Undo brings back the one you had.');
}

export function usedImageIds(pages: Page[]): Set<string> {
  const ids = new Set<string>();
  for (const p of pages) for (const id of fileIdsOf(p.blocks)) ids.add(id);
  return ids;
}

