/** Pinning boxes and pages to the desktop. The main window and the widget windows share one store of widgets (`registry.ts`). */
import type { Block, Page } from '../types';
import { newWidget, type WidgetSpec } from '../lib/widgets';
import { getStorage } from '../store/notes';
import { toast } from '../store/ui';
import { navigate } from '../lib/route';
import { listWidgets, removeWidget, saveWidget } from './registry';
import { autostartEnabled, closeWidgetWindow, onOpenPageRequest, openWidgetWindow, setKeepRunning, showMainWindow, startedInBackground, widgetsAvailable } from './host';

export { widgetsAvailable } from './host';

async function pin(spec: WidgetSpec, what: string) {
  if (!(await widgetsAvailable())) {
    toast('Desktop widgets are only in the laptop app.');
    return;
  }
  try {
    const store = getStorage();
    const known = (await listWidgets(store)).find((w) => w.id === spec.id);
    // Already pinned: keep where it was left and bring it forward.
    const use = known ?? spec;
    if (!known) await saveWidget(store, use);
    await openWidgetWindow(use);
    toast(known ? `${what} is already on your desktop.` : `${what} pinned to your desktop.`);
  } catch (e) {
    toast(`Couldn’t pin it: ${e instanceof Error ? e.message : e}`);
  }
}

/** Pins each of several boxes as its own widget. */
export async function pinBlocks(pageId: string, blocks: Block[]) {
  for (const b of blocks) if (b.type !== 'frame') await pinBlock(pageId, b);
}

export const pinBlock = (pageId: string, block: Block) => pin(newWidget(pageId, block), 'The box');
export const pinPage = (page: Page) => pin(newWidget(page.id, null), 'The page');

/** Removes a widget and closes its window. */
export async function unpinWidget(id: string): Promise<void> {
  await removeWidget(getStorage(), id);
  await closeWidgetWindow(id).catch(() => {});
}

export const pinnedWidgets = () => listWidgets(getStorage());

/**
 * Runs once in the main window: brings back the widgets, keeps the app in the tray when start-at-login is on,
 * opens pages that widgets ask for, and shows the window when the app was started at login with nothing to show.
 */
export async function setupDesktopWidgets(): Promise<void> {
  if (!(await widgetsAvailable())) return;
  try {
    await setKeepRunning(await autostartEnabled());
    const specs = await pinnedWidgets();
    for (const s of specs) await openWidgetWindow(s).catch((e) => console.warn('Widget failed to open', s.id, e));
    if (!specs.length && (await startedInBackground())) await showMainWindow();
    await onOpenPageRequest((id) => navigate({ name: 'page', id }));
  } catch (e) {
    console.warn('Desktop widgets setup failed', e);
  }
}
