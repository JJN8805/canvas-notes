import { useEffect, useRef, useState } from 'react';
import {
  closeSyncPanel,
  connect,
  disconnect,
  openSyncPanel,
  refreshAddresses,
  regenerateCode,
  startServer,
  stopServer,
  SYNC_PORT,
  syncNow,
  useSync,
} from '../../sync/controller';
import { confirmDanger, toast } from '../../store/ui';
import { Icon } from '../ui/Icon';

function ago(ts: number | null): string {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    toast('Copying isn’t available here. Select the text and copy it instead.');
  }
}

/** Toolbar button that opens the panel and shows the sync state at a glance. */
export function SyncButton() {
  const platform = useSync((s) => s.platform);
  const serverOn = useSync((s) => s.serverOn);
  const connected = useSync((s) => s.connected);
  const busy = useSync((s) => s.busy);
  const error = useSync((s) => s.error);
  const state = error ? 'error' : platform === 'desktop' ? (serverOn ? 'on' : 'off') : connected ? (busy ? 'busy' : 'on') : 'off';
  const label =
    platform === 'mobile' ? (busy ? 'Syncing…' : connected ? 'Synced' : 'Sync') : platform === 'desktop' && serverOn ? 'Phone sync on' : 'Sync';
  return (
    <button className={`btn sync-btn sync-${state}`} onClick={openSyncPanel} title="Sync with your phone or laptop">
      <span className={busy ? 'spin' : ''} style={{ display: 'inline-grid' }}>
        <Icon name="sync" size={16} />
      </span>
      {label}
      {state !== 'busy' && <span className="sync-dot" aria-hidden="true" />}
    </button>
  );
}

export function SyncPanel() {
  const open = useSync((s) => s.panelOpen);
  const platform = useSync((s) => s.platform);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void refreshAddresses();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSyncPanel();
      }
    };
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('input, button.primary')?.focus());
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && closeSyncPanel()}>
      <div ref={ref} className="dialog sync-panel" role="dialog" aria-modal="true" aria-label="Sync">
        <button className="icon-btn close-x" aria-label="Close" onClick={closeSyncPanel}>
          ×
        </button>
        {platform === 'desktop' ? <LaptopSync /> : platform === 'mobile' ? <PhoneSync /> : <BrowserNote />}
      </div>
    </div>
  );
}

function BrowserNote() {
  return (
    <>
      <h2>Sync</h2>
      <p>Sync works between the desktop app and the phone app. In this browser preview, notes stay in the browser.</p>
    </>
  );
}

function LaptopSync() {
  const s = useSync();
  return (
    <>
      <h2>Sync with your phone</h2>
      <p>
        When your phone and this laptop are on the same Wi-Fi, they keep the same notes. Notes go straight between the two devices,
        encrypted with the pairing code. Nothing goes through the internet.
      </p>

      <button
        className="switch-row"
        role="switch"
        aria-checked={s.serverOn}
        onClick={() => void (s.serverOn ? stopServer() : startServer())}
      >
        <span>Let my phone sync with this laptop</span>
        <span className="switch" aria-hidden="true" />
      </button>

      {s.serverOn && (
        <div className="sync-steps">
          <p className="step-lead">On your phone, open Canvas Notes, tap Sync, and enter:</p>
          <div className="kv">
            <div className="k">Laptop address</div>
            {s.addresses.length ? (
              s.addresses.map((a) => (
                <div key={a} className="v">
                  <code>{a}</code>
                  <button className="btn small" onClick={() => void copy(a, 'Address')}>
                    Copy
                  </button>
                </div>
              ))
            ) : (
              <div className="v muted">
                No network connection found. Connect this laptop to Wi-Fi, then
                <button className="link-btn" onClick={() => void refreshAddresses()}>
                  check again
                </button>
                .
              </div>
            )}
            <div className="k">Pairing code</div>
            <div className="v">
              <code className="code">{s.code}</code>
              <button className="btn small" onClick={() => void copy(s.code, 'Pairing code')}>
                Copy
              </button>
            </div>
          </div>
          <p className="muted small-text">
            {s.lastPhoneSync ? `Last synced with a phone ${ago(s.lastPhoneSync)}.` : 'No phone has synced yet.'} The app needs to be open on
            this laptop for your phone to sync.
          </p>
          <details className="small-text">
            <summary>Phone can’t connect?</summary>
            <ul>
              <li>Check both devices are on the same Wi-Fi network (not a guest network).</li>
              <li>
                If Ubuntu’s firewall is on, allow sync with <code>sudo ufw allow {SYNC_PORT}/tcp</code>.
              </li>
              <li>If the address changes from day to day, reserve a fixed IP for this laptop in your router’s settings.</li>
            </ul>
          </details>
          <button
            className="btn"
            onClick={async () => {
              const ok = await confirmDanger(
                'Make a new pairing code?',
                'Phones using the current code will stop syncing until you enter the new code on them.',
                'New code',
              );
              if (ok) await regenerateCode();
            }}
          >
            New pairing code
          </button>
        </div>
      )}
      {s.error && <p className="sync-error">{s.error}</p>}
    </>
  );
}

function PhoneSync() {
  const s = useSync();
  const [address, setAddress] = useState(s.peerAddress);
  const [code, setCode] = useState('');

  if (!s.connected) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void connect(address, code);
        }}
      >
        <h2>Connect to your laptop</h2>
        <p>
          On the laptop, open Canvas Notes, choose Sync and turn on phone sync. It shows the address and pairing code to enter here.
          Both devices need to be on the same Wi-Fi.
        </p>
        <label className="field-label" htmlFor="sync-address">
          Laptop address
        </label>
        <input
          id="sync-address"
          className="field"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="192.168.1.20"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <label className="field-label" htmlFor="sync-code">
          Pairing code
        </label>
        <input
          id="sync-code"
          className="field code-input"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        {s.error && <p className="sync-error">{s.error}</p>}
        <div className="row">
          <button type="submit" className="btn primary" disabled={s.busy}>
            {s.busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </form>
    );
  }

  const r = s.lastReport;
  return (
    <>
      <h2>Synced with your laptop</h2>
      <p>
        Connected to <code>{s.peerAddress}</code>. Notes sync when the app opens, every two minutes, and shortly after you edit, whenever
        you’re on the same Wi-Fi as the laptop.
      </p>
      <p className={s.error ? 'sync-error' : 'muted'}>
        {s.busy
          ? 'Syncing…'
          : s.error
            ? s.error
            : s.lastSync
              ? `Last synced ${ago(s.lastSync)}${r && (r.sent || r.received) ? `: ${r.sent} sent, ${r.received} received` : ''}.`
              : 'Not synced yet.'}
      </p>
      <div className="row spread">
        <button
          className="btn"
          onClick={async () => {
            const ok = await confirmDanger(
              'Disconnect from this laptop?',
              'Your notes stay on this phone. To sync again you’ll need the address and pairing code.',
              'Disconnect',
            );
            if (ok) await disconnect();
          }}
        >
          Disconnect
        </button>
        <button className="btn primary" disabled={s.busy} onClick={() => void syncNow()}>
          {s.busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
    </>
  );
}
