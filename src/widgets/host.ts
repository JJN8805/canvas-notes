/** The bridge to the desktop shell: widget windows, the tray and start-at-login. Every call is a no-op outside the laptop app. */
import { isTauri } from '../storage';
import { fitLogicalSize, needsFit, type WidgetSpec } from '../lib/widgets';
import { isSafeId } from '../storage/validate';

const OPEN_PAGE_EVENT = 'widget://open-page';

let available: Promise<boolean> | null = null;
let known = false;

/** The answer once `widgetsAvailable()` has resolved (false before that), for menus built on the spot. */
export const widgetsAvailableNow = () => known;

/** True only in the laptop app (not the phone app, not the browser preview). */
export function widgetsAvailable(): Promise<boolean> {
  if (!available) {
    available = (async () => {
      if (!isTauri()) return false;
      const { invoke } = await import('@tauri-apps/api/core');
      return (await invoke<string>('sync_platform')) === 'desktop';
    })()
      .catch(() => false)
      .then((v) => (known = v));
  }
  return available;
}

async function call<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export const openWidgetWindow = (s: WidgetSpec) =>
  call('widget_open', { id: s.id, pageId: s.pageId, blockId: s.blockId, x: s.x, y: s.y, w: s.w, h: s.h, bottom: s.bottom });
export const resizeWidgetWindow = (id: string, w: number, h: number) => call('widget_resize', { id, w, h });
export const closeWidgetWindow = (id: string) => call('widget_close', { id });
export const setWidgetLayer = (id: string, bottom: boolean) => call('widget_set_layer', { id, bottom });
export const showMainWindow = () => call('main_show');
export const startedInBackground = () => call<boolean>('started_in_background');
export const setKeepRunning = (on: boolean) => call('background_set', { on });

export async function autostartEnabled(): Promise<boolean> {
  const { isEnabled } = await import('@tauri-apps/plugin-autostart');
  return isEnabled();
}
export async function setAutostart(on: boolean): Promise<void> {
  const { enable, disable } = await import('@tauri-apps/plugin-autostart');
  await (on ? enable() : disable());
  await setKeepRunning(on);
}

/** A widget asks the main window to open its page. Only a plain page id travels. */
export async function requestOpenPage(pageId: string): Promise<void> {
  const { emit } = await import('@tauri-apps/api/event');
  await emit(OPEN_PAGE_EVENT, pageId);
  await showMainWindow();
}

/** The main window listens for those requests. The payload is checked before use. */
export async function onOpenPageRequest(cb: (pageId: string) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<unknown>(OPEN_PAGE_EVENT, (e) => {
    if (isSafeId(e.payload)) cb(e.payload);
  });
}

/** This widget window's position (logical pixels) and its page's size (CSS pixels, which is what a widget's size is saved in). */
export async function currentGeometry() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  const [pos, scale] = await Promise.all([win.innerPosition(), win.scaleFactor()]);
  return { x: pos.x / scale, y: pos.y / scale, w: window.innerWidth, h: window.innerHeight };
}

/**
 * Makes the page exactly `want` CSS pixels, once. Window sizes are in the window's own pixels while the page may be scaled
 * differently (fractional scaling on Linux), and some window managers add a frame, so the first size can be off.
 */
export async function fitWindowTo(id: string, want: { w: number; h: number }): Promise<void> {
  const have = { w: window.innerWidth, h: window.innerHeight };
  if (!needsFit(want, have)) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  const [size, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
  const next = fitLogicalSize(want, have, { w: size.width / scale, h: size.height / scale }, window.devicePixelRatio / scale);
  await resizeWidgetWindow(id, next.w, next.h);
}

/** Calls `cb` when this window is moved or resized. Returns a function that stops listening. */
export async function onWindowChanged(cb: () => void): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  const stops = await Promise.all([win.onMoved(cb), win.onResized(cb)]);
  return () => stops.forEach((s) => s());
}
