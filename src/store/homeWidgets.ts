/**
 * Keeps the phone's home screen widgets and the notes in step. On Android the widgets work with the app closed; whenever the app runs
 * (at start, and each time it comes back to the front) what was done on them is applied to the notes, and a fresh snapshot is published
 * a few seconds after anything changes. Nothing here runs on a laptop or in the browser.
 */
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { Page } from '../types';
import { adopt, listWorkspaces, splitGroups } from '../lib/workspaces';
import { applyAdd, applyToggle, buildSnapshot, emptySnapshot, parseActions } from '../lib/homeWidgets';
import { MAIN_NAME_KEY } from './notes/workspaceMemory';
import { dateKey } from '../lib/daily';
import { newId } from '../lib/util';
import { flushAll, get, getStorage, refreshFromDisk, useNotes } from './notes';
import { captureTo } from './capture';
import { openPageAnywhere } from './workspaces';
import { history } from './history';
import { featureOn } from './features';
import { toast } from './ui';

export type WidgetKind = 'list' | 'capture' | 'page';

export const useHomeWidgets = create<{ available: boolean; canPin: boolean }>(() => ({ available: false, canPin: false }));

const call = <T,>(command: string, args?: Record<string, unknown>) => invoke<T>(`plugin:homewidgets|${command}`, args);

let started = false;
let running: Promise<void> = Promise.resolve();
/** One thing at a time: applying and publishing both read and write the same notes. */
const queued = (job: () => Promise<void>) => (running = running.then(job).catch((e) => console.error('Home screen widgets', e)));

async function everything() {
  const storage = getStorage();
  const loaded = await storage.loadAll();
  const rows = splitGroups(loaded.groups, null).workspaces;
  const pages = adopt(loaded.pages, rows);
  const mainName = (await storage.getSetting(MAIN_NAME_KEY).catch(() => null)) ?? get().mainName;
  return { pages, names: new Map(listWorkspaces(rows, mainName).map((w) => [w.id, w.name])) };
}

async function publish() {
  await flushAll();
  let snapshot = emptySnapshot();
  if (featureOn('widgets')) {
    const { pages, names } = await everything();
    snapshot = buildSnapshot(pages, names);
  }
  await call('publish', { snapshot: JSON.stringify(snapshot) });
}

/** Applies what was done on the widgets. An action is acknowledged only once its note is saved. */
async function drain() {
  const { actions, rejected } = parseActions((await call<{ actions: string }>('pending')).actions);
  if (!actions.length && !rejected.length) return;
  await flushAll();
  const storage = getStorage();
  const pages = new Map<string, Page>((await everything()).pages.map((p) => [p.id, p]));
  const done = [...rejected];
  const workspace = get().workspace ?? '';
  const today = dateKey();
  let changed = 0;
  let open: string | null = null;
  const save = async (page: Page) => {
    const res = await storage.savePage(page);
    if (!res.ok) return false;
    pages.set(page.id, (await storage.loadPage(page.id)) ?? page);
    history.clear(page.id);
    changed++;
    return true;
  };
  for (const a of [...actions].sort((x, y) => x.at - y.at)) {
    if (a.type === 'open') {
      open = a.page;
      done.push(a.id);
    } else if (a.type === 'capture') {
      const id = await captureTo(workspace, a.text);
      if (id) {
        const saved = await storage.loadPage(id);
        if (saved) pages.set(id, saved);
        done.push(a.id);
      }
    } else {
      const page = a.type === 'toggle' ? applyToggle([...pages.values()], a, today) : applyAdd([...pages.values()], a, workspace, newId)?.page ?? null;
      if (!page || (await save(page))) done.push(a.id);
    }
  }
  if (changed) await refreshFromDisk();
  await call('ack', { ids: done });
  if (changed) toast(`${changed === 1 ? 'A change' : `${changed} changes`} from your home screen widgets added.`);
  if (open) await openPageAnywhere(open);
}

const sync = () => queued(async () => {
  await drain();
  await publish();
});

/** Started once the notes are loaded. Does nothing where there are no home screen widgets. */
export async function startHomeWidgets(): Promise<void> {
  if (started || !('__TAURI_INTERNALS__' in window)) return;
  started = true;
  let status: { canPin: boolean };
  try {
    status = await call<{ canPin: boolean }>('status');
  } catch {
    return; // not Android: the commands do not exist
  }
  useHomeWidgets.setState({ available: true, canPin: status.canPin });
  void sync();
  let timer = 0;
  useNotes.subscribe((s, before) => {
    if (s.pages === before.pages && s.workspaces === before.workspaces) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void queued(publish), 3000);
  });
  document.addEventListener('visibilitychange', () => {
    window.clearTimeout(timer);
    if (document.hidden) void queued(publish);
    else void sync();
  });
}

/** Asks Android to put a widget on the home screen (it shows its own confirmation). */
export async function addHomeWidget(kind: WidgetKind): Promise<void> {
  await queued(publish);
  try {
    const { asked } = await call<{ asked: boolean }>('pin', { kind });
    if (!asked) toast('Long-press your home screen, choose Widgets, then Canvas Notes.');
  } catch (e) {
    console.error(e);
    toast('Long-press your home screen, choose Widgets, then Canvas Notes.');
  }
}
