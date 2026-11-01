import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chooseDailyTemplate, getStorage, refreshFromDisk, useNotes } from '../../store/notes';
import {
  setAutoSync,
  setProfileColor,
  setProfileName,
  setSnap,
  setTheme,
  setTrashDays,
  usePrefs,
} from '../../store/prefs';
import { closeSettings, useSettingsUi } from '../../store/settingsUi';
import { resolveDailyTemplate, templatesOf } from '../../lib/pages';
import { MAX_NAME, PROFILE_COLORS, TRASH_CHOICES, type Theme } from '../../lib/settings';
import { buildBackup, parseBackup, restoreBackup } from '../../lib/backup';
import { saveBytes } from '../../export/export';
import { openSyncPanel, useSync } from '../../sync/controller';
import { confirmDanger, toast } from '../../store/ui';
import { Avatar } from './Avatar';
import { version } from '../../../package.json';

const TABS = ['Profile', 'Appearance', 'Editor', 'Sync', 'Data', 'About'] as const;
type Tab = (typeof TABS)[number];

export function SettingsDialog() {
  const open = useSettingsUi((s) => s.open);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const [tab, setTab] = useState<Tab>('Profile');
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevFocus = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  function close() {
    closeSettings();
    (prevFocus.current as HTMLElement | null)?.focus?.();
  }

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog settings" role="dialog" aria-modal="true" aria-label="Settings">
        <h2>Settings</h2>
        <div className="set-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={'set-tab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="set-body" role="tabpanel" aria-label={tab}>
          {tab === 'Profile' && <ProfileTab />}
          {tab === 'Appearance' && <AppearanceTab />}
          {tab === 'Editor' && <EditorTab />}
          {tab === 'Sync' && <SyncTab />}
          {tab === 'Data' && <DataTab />}
          {tab === 'About' && <AboutTab />}
        </div>
        <div className="row">
          <button ref={closeRef} className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button className="switch-row" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>{label}</span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/* ---------------- Profile ---------------- */

function ProfileTab() {
  const name = usePrefs((s) => s.profileName);
  const color = usePrefs((s) => s.profileColor);
  const [draft, setDraft] = useState(name);
  const storage = () => getStorage();
  const commit = () => {
    if (draft !== name) setProfileName(draft, storage());
  };
  return (
    <>
      <Section title="Your profile">
        <div className="profile-edit">
          <Avatar name={draft} color={color} size={56} />
          <label className="grow">
            <span className="field-label">Display name</span>
            <input
              className="field"
              value={draft}
              maxLength={MAX_NAME}
              placeholder="Your name"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
          </label>
        </div>
        <span className="field-label">Colour</span>
        <div className="swatches" role="radiogroup" aria-label="Profile colour">
          {PROFILE_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              className={'swatch' + (color === c ? ' on' : '')}
              style={{ background: `var(--c-${c})` }}
              onClick={() => setProfileColor(c, storage())}
            />
          ))}
        </div>
        <p>
          This is a local profile: it lives on this device only and is never sent anywhere, since Canvas Notes has no accounts. Your name shows at the top of the sidebar.
        </p>
      </Section>
    </>
  );
}

/* ---------------- Appearance ---------------- */

const THEME_LABELS: Record<Theme, string> = { system: 'Match my system', light: 'Light', dark: 'Dark' };

function AppearanceTab() {
  const theme = usePrefs((s) => s.theme);
  return (
    <Section title="Theme">
      <div className="seg" role="radiogroup" aria-label="Theme">
        {(Object.keys(THEME_LABELS) as Theme[]).map((t) => (
          <button key={t} role="radio" aria-checked={theme === t} className={'seg-btn' + (theme === t ? ' on' : '')} onClick={() => setTheme(t, getStorage())}>
            {THEME_LABELS[t]}
          </button>
        ))}
      </div>
      <p>Exports (PNG, PDF) are always drawn in the light theme, whichever you pick here.</p>
    </Section>
  );
}

/* ---------------- Editor ---------------- */

function EditorTab() {
  const snap = usePrefs((s) => s.snap);
  const pages = useNotes((s) => s.pages);
  const setting = usePrefs((s) => s.dailyTemplate);
  const templates = useMemo(() => templatesOf(pages), [pages]);
  const current = resolveDailyTemplate(pages, setting)?.id ?? 'none';
  return (
    <>
      <Section title="Canvas">
        <Switch label="Snap to other boxes and the grid" on={snap} onChange={(on) => setSnap(on, getStorage())} />
        <p>While you drag or resize, edges line up with nearby boxes. Hold Alt to move freely for one drag, whatever this says.</p>
      </Section>
      <Section title="Daily page">
        <label className="set-row">
          <span>Start each new daily page from</span>
          <select className="field" value={current} onChange={(e) => chooseDailyTemplate(e.target.value)}>
            <option value="none">Blank page</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title || 'Untitled template'}
              </option>
            ))}
          </select>
        </label>
        <p>A daily page is only created when you open that day, never in the background.</p>
      </Section>
    </>
  );
}

/* ---------------- Sync ---------------- */

function SyncTab() {
  const platform = useSync((s) => s.platform);
  const serverOn = useSync((s) => s.serverOn);
  const connected = useSync((s) => s.connected);
  const autoSync = usePrefs((s) => s.autoSync);
  const status =
    platform === 'browser'
      ? 'Not available in the browser preview.'
      : platform === 'desktop'
        ? serverOn
          ? 'This laptop is ready for your phone to sync.'
          : 'Phone sync is off.'
        : connected
          ? 'Paired with your laptop.'
          : 'Not paired with a laptop yet.';
  return (
    <Section title="Wi-Fi sync">
      <p>{status}</p>
      {platform === 'mobile' && (
        <>
          <Switch label="Sync automatically" on={autoSync} onChange={(on) => setAutoSync(on, getStorage())} />
          <p>Automatic syncing runs when the app opens, every two minutes and shortly after edits. When it’s off, the Sync button still syncs on request.</p>
        </>
      )}
      <button
        className="btn"
        disabled={platform === 'browser'}
        onClick={() => {
          closeSettings();
          openSyncPanel();
        }}
      >
        {platform === 'mobile' ? 'Pair or sync now…' : 'Pairing code and phone sync…'}
      </button>
    </Section>
  );
}

/* ---------------- Data ---------------- */

function DataTab() {
  const trashDays = usePrefs((s) => s.trashDays);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function exportAll() {
    setBusy(true);
    try {
      const backup = await buildBackup(getStorage());
      const bytes = new TextEncoder().encode(JSON.stringify(backup)) as Uint8Array<ArrayBuffer>;
      const day = new Date().toISOString().slice(0, 10);
      const saved = await saveBytes(`canvas-notes-backup-${day}`, 'json', bytes);
      if (saved) toast(`Saved ${backup.pages.length} page${backup.pages.length === 1 ? '' : 's'} to ${saved}`);
    } catch (e) {
      toast(`The backup couldn’t be saved: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    try {
      const backup = parseBackup(await file.text());
      const ok = await confirmDanger(
        'Restore from backup?',
        `This adds ${backup.pages.length} page${backup.pages.length === 1 ? '' : 's'} from the backup. Pages you already have are left as they are.`,
        'Restore',
      );
      if (!ok) return;
      const r = await restoreBackup(getStorage(), backup);
      await refreshFromDisk();
      toast(
        r.pages
          ? `Restored ${r.pages} page${r.pages === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} you already have` : ''}.`
          : 'Nothing to restore: you already have every page in that backup.',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      <Section title="Backup">
        <p>Save every page, group and picture to one file you keep wherever you like, and add them back later or on another computer.</p>
        <div className="row start">
          <button className="btn" disabled={busy} onClick={() => void exportAll()}>
            Back up all notes…
          </button>
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            Restore from backup…
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </div>
      </Section>
      <Section title="Trash">
        <label className="set-row">
          <span>Empty deleted pages after</span>
          <select className="field" value={trashDays} onChange={(e) => setTrashDays(Number(e.target.value), getStorage())}>
            {TRASH_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <p>Applied each time the app starts. Page history is always kept for 30 days.</p>
      </Section>
    </>
  );
}

/* ---------------- About ---------------- */

const SHORTCUTS: [string, string][] = [
  ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / redo'],
  ['Ctrl + D', 'Duplicate selected boxes'],
  ['Ctrl + A', 'Select all boxes'],
  ['Delete', 'Remove selected boxes'],
  ['S', 'New sticky note'],
  ['Ctrl + P', 'Command palette'],
  ['Ctrl + O', 'Quick switcher: find and open a page'],
  ['Ctrl + Alt + D', 'Open today’s page'],
  ['Space + drag', 'Pan the page'],
  ['Ctrl + scroll', 'Zoom'],
  ['Ctrl + 1', 'Zoom to fit everything on the page'],
  ['Alt while dragging', 'Move without snapping'],
];

function AboutTab() {
  const kind = useNotes((s) => s.storageKind);
  const where = useNotes((s) => s.storageLocation);
  return (
    <>
      <Section title="Canvas Notes">
        <div className="kv">
          <span className="k">Version</span>
          <span className="v">{version}</span>
          <span className="k">Stored</span>
          <span className="v">{kind === 'desktop' ? where : 'In this browser only (development mode)'}</span>
        </div>
        <p>Your notes stay on your devices. Nothing is sent over the internet.</p>
      </Section>
      <Section title="Keyboard shortcuts">
        <div className="kv">
          {SHORTCUTS.map(([k, v]) => (
            <span key={k} className="kv-row">
              <kbd>{k}</kbd>
              <span>{v}</span>
            </span>
          ))}
        </div>
      </Section>
    </>
  );
}
