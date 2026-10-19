import { create } from 'zustand';
import { isTauri } from '../storage';
import { flushAll, getStorage, refreshFromDisk, resolveDailyDuplicates, useNotes } from '../store/notes';
import { toast } from '../store/ui';
import { handleRequest, syncWithLaptop, type SyncReport, type SyncRequest } from './engine';

export const SYNC_PORT = 47821;
const AUTO_INTERVAL = 2 * 60 * 1000;
const AFTER_EDIT_DELAY = 20 * 1000;

type Platform = 'desktop' | 'mobile' | 'browser';

interface SyncState {
  platform: Platform;
  panelOpen: boolean;
  /* laptop */
  serverOn: boolean;
  code: string;
  addresses: string[];
  lastPhoneSync: number | null;
  /* phone */
  peerAddress: string;
  peerCode: string;
  connected: boolean;
  lastSync: number | null;
  lastReport: SyncReport | null;
  /* both */
  busy: boolean;
  error: string;
}

export const useSync = create<SyncState>(() => ({
  platform: 'browser',
  panelOpen: false,
  serverOn: false,
  code: '',
  addresses: [],
  lastPhoneSync: null,
  peerAddress: '',
  peerCode: '',
  connected: false,
  lastSync: null,
  lastReport: null,
  busy: false,
  error: '',
}));

const set = useSync.setState;
const get = useSync.getState;

export const openSyncPanel = () => set({ panelOpen: true });
export const closeSyncPanel = () => set({ panelOpen: false });

async function invokeCmd<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

const setting = (k: string) => getStorage().getSetting(k);
const saveSetting = (k: string, v: string | null) => getStorage().setSetting(k, v);

/* ------------------------------------------------------------------ */
/* Pairing code                                                        */
/* ------------------------------------------------------------------ */

// No 0/O, 1/I/L: easy to read off a screen and type on a phone.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 20 characters (about 99 bits), shown as XXXX-XXXX-XXXX-XXXX-XXXX. */
export function generateCode(): string {
  const out: string[] = [];
  while (out.length < 20) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 248 && out.length < 20) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join('').replace(/(.{4})(?=.)/g, '$1-');
}

export function normalizeCode(input: string): string {
  const clean = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return clean.replace(/(.{4})(?=.)/g, '$1-');
}

/** "192.168.1.20", "192.168.1.20:47821" or a full URL → the sync endpoint. */
export function endpointFor(address: string): string {
  let host = address.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!/:\d+$/.test(host)) host += `:${SYNC_PORT}`;
  return `http://${host}/v1`;
}

/* ------------------------------------------------------------------ */
/* Start-up                                                            */
/* ------------------------------------------------------------------ */

let started = false;

export async function initSync() {
  if (started) return;
  started = true;
  if (!isTauri()) return; // `npm run dev` in a browser: no sync
  const platform = (await invokeCmd<string>('sync_platform')) === 'mobile' ? 'mobile' : 'desktop';
  set({ platform });
  if (platform === 'desktop') await initLaptop();
  else await initPhone();
}

/* ------------------------------------------------------------------ */
/* Laptop                                                              */
/* ------------------------------------------------------------------ */

let refreshTimer: number | null = null;
function refreshSoon() {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    // The laptop is the one that settles two devices having made the same day's page (the phone then receives the fix).
    void refreshFromDisk().then(() => resolveDailyDuplicates());
  }, 300);
}

async function initLaptop() {
  let code = await setting('sync.code');
  if (!code) {
    code = generateCode();
    await saveSetting('sync.code', code);
  }
  const last = Number(await setting('sync.lastPhoneSync')) || null;
  set({ code, lastPhoneSync: last });

  const { listen } = await import('@tauri-apps/api/event');
  await listen<{ id: number; body: string }>('sync://request', async (event) => {
    const { id, body } = event.payload;
    let reply: string;
    try {
      const req = JSON.parse(body) as SyncRequest;
      if (req.op === 'manifest') {
        const now = Date.now();
        set({ lastPhoneSync: now });
        void saveSetting('sync.lastPhoneSync', String(now));
      }
      const result = await handleRequest(getStorage().sync, req, { beforeRead: flushAll, afterWrite: refreshSoon });
      reply = JSON.stringify({ ok: true, result });
    } catch (e) {
      reply = JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    await invokeCmd('sync_server_reply', { id, body: reply });
  });

  if ((await setting('sync.server')) === 'on') await startServer();
}

export async function startServer() {
  try {
    const info = await invokeCmd<{ addresses: string[]; port: number }>('sync_server_start', { code: get().code });
    set({ serverOn: true, addresses: info.addresses, error: '' });
    await saveSetting('sync.server', 'on');
  } catch (e) {
    set({ serverOn: false, error: String(e) });
  }
}

export async function stopServer() {
  await invokeCmd('sync_server_stop');
  set({ serverOn: false, error: '' });
  await saveSetting('sync.server', null);
}

export async function refreshAddresses() {
  if (get().platform !== 'desktop') return;
  set({ addresses: await invokeCmd<string[]>('sync_local_addresses') });
}

/** New code: phones paired with the old one stop working until they enter it. */
export async function regenerateCode() {
  const code = generateCode();
  await saveSetting('sync.code', code);
  set({ code });
  if (get().serverOn) await startServer();
}

/* ------------------------------------------------------------------ */
/* Phone                                                               */
/* ------------------------------------------------------------------ */

async function initPhone() {
  const peerAddress = (await setting('sync.peerAddress')) ?? '';
  const peerCode = (await setting('sync.peerCode')) ?? '';
  const lastSync = Number(await setting('sync.lastSync')) || null;
  set({ peerAddress, peerCode, lastSync, connected: !!(peerAddress && peerCode) });

  // Sync when the app opens or comes back to the front, every two minutes,
  // and shortly after edits.
  window.setTimeout(() => void syncNow({ quiet: true }), 1500);
  const onFront = () => {
    const last = get().lastSync ?? 0;
    if (document.visibilityState === 'visible' && Date.now() - last > 20_000) void syncNow({ quiet: true });
  };
  document.addEventListener('visibilitychange', onFront);
  window.addEventListener('focus', onFront);
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow({ quiet: true });
  }, AUTO_INTERVAL);

  let editTimer: number | null = null;
  useNotes.subscribe((s, prev) => {
    if (applyingSync || s.pages === prev.pages || !get().connected) return;
    if (editTimer !== null) clearTimeout(editTimer);
    editTimer = window.setTimeout(() => void syncNow({ quiet: true }), AFTER_EDIT_DELAY);
  });
}

function sender(address: string, code: string) {
  const url = endpointFor(address);
  return async <T,>(req: SyncRequest): Promise<T> => {
    const raw = await invokeCmd<string>('sync_client_request', { url, code, body: JSON.stringify(req) });
    const res = JSON.parse(raw) as { ok: boolean; result?: T; error?: string };
    if (!res.ok) throw new Error(res.error || 'The laptop couldn’t complete the sync.');
    return res.result as T;
  };
}

/** Checks the address and code, then saves them and syncs. */
export async function connect(address: string, rawCode: string): Promise<boolean> {
  const code = normalizeCode(rawCode);
  if (!address.trim()) {
    set({ error: 'Enter the laptop’s address, shown in its Sync panel.' });
    return false;
  }
  if (code.replace(/-/g, '').length !== 20) {
    set({ error: 'The pairing code has 20 letters and digits. Check you copied all of it.' });
    return false;
  }
  set({ busy: true, error: '' });
  try {
    const hello = await sender(address, code)<{ app: string }>({ op: 'hello' });
    if (hello.app !== 'canvas-notes') throw new Error('That address isn’t a Canvas Notes laptop.');
    await saveSetting('sync.peerAddress', address.trim());
    await saveSetting('sync.peerCode', code);
    set({ peerAddress: address.trim(), peerCode: code, connected: true, busy: false });
    await syncNow();
    return true;
  } catch (e) {
    set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export async function disconnect() {
  await saveSetting('sync.peerAddress', null);
  await saveSetting('sync.peerCode', null);
  set({ connected: false, peerCode: '', error: '' });
}

let applyingSync = false;
let running: Promise<void> | null = null;

export function syncNow(opts: { quiet?: boolean } = {}): Promise<void> {
  const s = get();
  if (s.platform !== 'mobile' || !s.connected) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    set({ busy: true });
    try {
      await flushAll();
      const report = await syncWithLaptop(getStorage().sync, sender(s.peerAddress, s.peerCode));
      applyingSync = true;
      try {
        await refreshFromDisk();
      } finally {
        applyingSync = false;
      }
      const now = Date.now();
      set({ lastSync: now, lastReport: report, error: '' });
      await saveSetting('sync.lastSync', String(now));
      if (report.conflicts) {
        toast(
          report.conflicts === 1
            ? 'A page was edited on both devices. Your phone’s version was kept as a “conflicted copy”.'
            : `${report.conflicts} pages were edited on both devices. Your phone’s versions were kept as “conflicted copies”.`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg });
      if (!opts.quiet) toast(msg);
    } finally {
      set({ busy: false });
      running = null;
    }
  })();
  return running;
}
