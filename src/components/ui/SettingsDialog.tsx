import { COARSE } from '../../lib/touch';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { chooseDailyTemplate, getStorage, refreshFromDisk, useNotes } from '../../store/notes';
import {
  setAutoSync,
  setProfileColor,
  setProfileName,
  setCustomTheme,
  setPalette,
  setKeymap,
  setSnap,
  setTheme,
  setTrashDays,
  usePrefs,
} from '../../store/prefs';
import { closeSettings, useSettingsUi } from '../../store/settingsUi';
import { resolveDailyTemplate, templatesOf } from '../../lib/pages';
import { MAX_NAME, PROFILE_COLORS, TRASH_CHOICES, type Theme } from '../../lib/settings';
import { buildBackup, parseBackup, restoreBackup } from '../../lib/backup';
import { backupToZip, isZip, zipToBackup } from '../../lib/archiveZip';
import { archiveFolder, autoArchiveAvailable, loadAutoState, runAutoArchive, saveAutoConfig, type AutoState } from '../../store/autoArchive';
import type { AutoArchive } from '../../lib/autoArchive';
import { decryptBackupText, encryptBackupText, isEncryptedBackup } from '../../lib/backupCrypto';
import { saveBytes } from '../../export/export';
import { openSyncPanel, useSync } from '../../sync/controller';
import { ask, confirmDanger, toast } from '../../store/ui';
import { Avatar } from './Avatar';
import { Section, Switch } from './SettingsParts';
import { GeneralTab } from './GeneralTab';
import { DesktopTab } from './SettingsDesktop';
import { AddonsTab } from './SettingsAddons';
import { FeaturesTab } from './FeaturesTab';
import { useFeature } from '../../store/features';
import { CUSTOM_PALETTE, DEFAULT_CUSTOM, DEFAULT_PALETTE, isReadable, PRESETS, type ThemeColors } from '../../lib/themes';

const TABS = ['General', 'Profile', 'Appearance', 'Editor', 'Features', 'Sync', 'Desktop', 'Add-ons', 'Data', 'About'] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, IconName> = { General: 'settings', Profile: 'user', Appearance: 'palette', Editor: 'edit', Features: 'check', Sync: 'sync', Desktop: 'monitor', 'Add-ons': 'puzzle', Data: 'database', About: 'info' };

export function SettingsDialog() {
  const open = useSettingsUi((s) => s.open);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const [tab, setTab] = useState<Tab>('General');
  const syncOn = useFeature('sync');
  const widgetsOn = useFeature('widgets');
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
          {TABS.filter((t) => (t !== 'Sync' || syncOn) && (t !== 'Desktop' || widgetsOn)).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={'set-tab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
              <Icon name={TAB_ICONS[t]} size={15} />
              {t}
            </button>
          ))}
        </div>
        <div className="set-body" role="tabpanel" aria-label={tab}>
          {tab === 'General' && <GeneralTab />}
          {tab === 'Profile' && <ProfileTab />}
          {tab === 'Appearance' && <AppearanceTab />}
          {tab === 'Editor' && <EditorTab />}
          {tab === 'Features' && <FeaturesTab />}
          {tab === 'Sync' && <SyncTab />}
          {tab === 'Desktop' && <DesktopTab />}
          {tab === 'Add-ons' && <AddonsTab />}
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
const THEME_ICONS: Record<Theme, IconName> = { system: 'monitor', light: 'sun', dark: 'moon' };

function AppearanceTab() {
  const theme = usePrefs((s) => s.theme);
  const palette = usePrefs((s) => s.palette);
  const custom = usePrefs((s) => s.custom);
  const colored = palette !== DEFAULT_PALETTE;
  return (
    <>
      <Section title="Mode">
        <div className="seg" role="radiogroup" aria-label="Mode">
          {(Object.keys(THEME_LABELS) as Theme[]).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={theme === t}
              className={'seg-btn' + (theme === t ? ' on' : '')}
              disabled={colored}
              onClick={() => setTheme(t, getStorage())}
            >
              <Icon name={THEME_ICONS[t]} size={16} />
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
        <p>{colored ? 'A colour theme is light or dark by itself. Choose Default below to use this setting again.' : 'Light, dark, or whatever your computer is set to.'}</p>
      </Section>
      <Section title="Colour theme">
        <div className="theme-grid" role="radiogroup" aria-label="Colour theme">
          <ThemeCard id={DEFAULT_PALETTE} label="Default" colors={null} active={palette === DEFAULT_PALETTE} />
          {PRESETS.map((p) => (
            <ThemeCard key={p.id} id={p.id} label={p.label} colors={p} active={palette === p.id} />
          ))}
          <ThemeCard id={CUSTOM_PALETTE} label="Custom" colors={custom} active={palette === CUSTOM_PALETTE} />
        </div>
        <CustomEditor custom={custom} active={palette === CUSTOM_PALETTE} />
        <p>Exports (PNG, PDF) are always drawn in the light theme, whichever you pick here.</p>
      </Section>
    </>
  );
}

/** A small preview of a theme: its background, surface, text and accent. `null` shows the default look. */
function ThemeCard({ id, label, colors, active }: { id: string; label: string; colors: ThemeColors | null; active: boolean }) {
  return (
    <button role="radio" aria-checked={active} className={'theme-card' + (active ? ' on' : '')} onClick={() => setPalette(id, getStorage())}>
      <span className="theme-prev" style={colors ? { background: colors.desk } : undefined}>
        {colors ? (
          <>
            <span className="theme-sheet" style={{ background: colors.sheet, color: colors.ink }}>Aa</span>
            <span className="theme-dot" style={{ background: colors.accent }} />
          </>
        ) : (
          <>
            <span className="theme-half light" />
            <span className="theme-half dark" />
          </>
        )}
      </span>
      <span className="theme-name">
        {active && <Icon name="check" size={14} />}
        {label}
      </span>
    </button>
  );
}

const CUSTOM_FIELDS: [keyof Omit<ThemeColors, 'base'>, string][] = [
  ['desk', 'Background'],
  ['sheet', 'Surface'],
  ['ink', 'Text'],
  ['accent', 'Accent'],
];

/** Pickers for the custom theme. Changing any colour switches to the custom theme straight away. */
function CustomEditor({ custom, active }: { custom: ThemeColors; active: boolean }) {
  const set = (patch: Partial<ThemeColors>) => setCustomTheme({ ...custom, ...patch }, getStorage());
  return (
    <div className="custom-theme">
      <h3>Make your own</h3>
      <div className="seg" role="radiogroup" aria-label="Custom theme base">
        {(['light', 'dark'] as const).map((b) => (
          <button key={b} role="radio" aria-checked={custom.base === b} className={'seg-btn' + (custom.base === b ? ' on' : '')} onClick={() => set({ base: b })}>
            <Icon name={b === 'light' ? 'sun' : 'moon'} size={16} />
            {b === 'light' ? 'Light base' : 'Dark base'}
          </button>
        ))}
      </div>
      <div className="color-fields">
        {CUSTOM_FIELDS.map(([key, label]) => (
          <label key={key} className="color-field">
            <input type="color" value={custom[key]} onChange={(e) => set({ [key]: e.target.value })} aria-label={label} />
            <span>{label}</span>
          </label>
        ))}
        <button className="btn small" onClick={() => set(DEFAULT_CUSTOM)}>Reset</button>
      </div>
      {active && !isReadable(custom) && <p className="warn">The text colour is hard to read on these backgrounds. Pick a lighter or darker text colour.</p>}
    </div>
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
      <Section title="Journal">
        <label className="set-row">
          <span>Start each new journal page from</span>
          <select className="field" value={current} onChange={(e) => chooseDailyTemplate(e.target.value)}>
            <option value="none">Blank page</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title || 'Untitled template'}
              </option>
            ))}
          </select>
        </label>
        <p>A journal page is only created when you open or start that day, never in the background.</p>
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

/** The automatic archive file: a dated .zip made for you, daily or weekly, the newest few kept in the app's folder. */
function AutoArchiveSection() {
  const [state, setState] = useState<AutoState | null>(null);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadAutoState().then(setState);
    void archiveFolder().then(setFolder).catch(() => {});
  }, []);
  if (!state) return null;
  const change = async (cfg: AutoArchive) => {
    await saveAutoConfig(cfg);
    setState({ ...state, cfg });
  };
  const when = state.last ? new Date(state.last).toLocaleString() : 'never';
  return (
    <Section title="Automatic archive">
      <p>Keeps a dated archive file of everything (pages, pictures, GIFs, videos, audio and PDFs) in a folder on this computer, so there is always a recent copy to go back to. The newest few are kept; older ones are removed. Last one: {when}.</p>
      <label className="set-row">
        <span>Make an archive</span>
        <select className="field" value={state.cfg.mode} onChange={(e) => void change({ ...state.cfg, mode: e.target.value as AutoArchive['mode'] })}>
          <option value="off">Never</option>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
        </select>
      </label>
      <label className="set-row">
        <span>Keep the newest</span>
        <select className="field" value={state.cfg.keep} onChange={(e) => void change({ ...state.cfg, keep: Number(e.target.value) })}>
          {[1, 2, 4, 7, 14, 30].map((n) => (
            <option key={n} value={n}>{n} archive{n === 1 ? '' : 's'}</option>
          ))}
        </select>
      </label>
      <div className="row start">
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const name = await runAutoArchive(true);
            setBusy(false);
            if (name) {
              toast(`Saved ${name}`);
              setState(await loadAutoState());
            }
          }}
        >
          Make one now
        </button>
      </div>
      {folder && <p className="muted">Folder: {folder}</p>}
    </Section>
  );
}

function DataTab() {
  const trashDays = usePrefs((s) => s.trashDays);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function exportAll(encrypted: boolean) {
    setBusy(true);
    try {
      let passphrase = '';
      if (encrypted) {
        const first = await ask({
          title: 'Passphrase for this backup',
          text: 'You will need it to open the backup. It is not saved anywhere, and nobody can recover it for you.',
          placeholder: 'Passphrase',
          okLabel: 'Next',
          secret: true,
        });
        if (!first) return;
        const again = await ask({ title: 'Type the passphrase again', placeholder: 'Passphrase', okLabel: 'Encrypt and save', secret: true });
        if (again === null) return;
        if (again !== first) {
          toast('The two passphrases didn’t match. Nothing was saved.');
          return;
        }
        passphrase = first;
      }
      const backup = await buildBackup(getStorage());
      const json = JSON.stringify(backup);
      const text = encrypted ? await encryptBackupText(json, passphrase) : json;
      const bytes = new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
      const day = new Date().toISOString().slice(0, 10);
      const saved = await saveBytes(`canvas-notes-backup-${day}${encrypted ? '-encrypted' : ''}`, 'json', bytes);
      if (saved) toast(`Saved ${backup.pages.length} page${backup.pages.length === 1 ? '' : 's'} to ${saved}`);
    } catch (e) {
      toast(`The backup couldn’t be saved: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  /** One .zip with the pages and every picture, GIF, video, audio clip and PDF as normal files: for keeping, not for the app only. */
  async function exportZip() {
    setBusy(true);
    try {
      const backup = await buildBackup(getStorage());
      const day = new Date().toISOString().slice(0, 10);
      const saved = await saveBytes(`canvas-notes-archive-${day}`, 'zip', backupToZip(backup));
      if (saved) toast(`Saved ${backup.pages.length} page${backup.pages.length === 1 ? '' : 's'} and ${backup.images.length} file${backup.images.length === 1 ? '' : 's'} to ${saved}`);
    } catch (e) {
      toast(`The archive couldn’t be saved: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      let backup;
      if (isZip(head)) {
        backup = zipToBackup(new Uint8Array(await file.arrayBuffer())); // an archive file
      } else {
        let text = await file.text();
        if (isEncryptedBackup(text)) {
          const passphrase = await ask({ title: 'This backup is encrypted', text: 'Enter the passphrase you chose when you made it.', placeholder: 'Passphrase', okLabel: 'Open', secret: true });
          if (passphrase === null) return;
          text = await decryptBackupText(text, passphrase);
        }
        backup = parseBackup(text);
      }
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
        <p>Save every page, group and picture to one file you keep wherever you like, and add them back later or on another computer. An encrypted backup is locked with a passphrase you choose; without it the file can’t be opened by anyone. The passphrase is not stored, so keep it safe. (Your notes on this computer are not encrypted by the app; use your system’s disk encryption for that.)</p>
        <div className="row start">
          <button className="btn" disabled={busy} onClick={() => void exportAll(false)}>
            Back up all notes…
          </button>
          <button className="btn" disabled={busy} title="Locks the file with a passphrase you choose" onClick={() => void exportAll(true)}>
            Encrypted backup…
          </button>
          <button className="btn" disabled={busy} title="One .zip with your pages and every picture, video and audio clip as normal files" onClick={() => void exportZip()}>
            Archive file (.zip)…
          </button>
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            Restore from backup or archive…
          </button>
          <input ref={fileRef} type="file" accept=".json,.zip,application/json,application/zip" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </div>
      </Section>
      {autoArchiveAvailable() && <AutoArchiveSection />}
      <StorageSection />
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

/* ---------------- Storage ---------------- */

/** How much room the notes take and how much of it is shared instead of copied. Pictures and page history keep each distinct thing once. */
function StorageSection() {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => getStorage().report().then(setReport, () => setReport(null));
  useEffect(() => {
    void refresh();
  }, []);

  async function tidy() {
    setBusy(true);
    try {
      const r = await getStorage().tidy();
      await refresh();
      toast(
        r.filesMerged || r.versionsConverted
          ? `Tidied: ${r.filesMerged ? `${r.filesMerged} duplicate file${r.filesMerged === 1 ? '' : 's'} merged (${formatSize(r.bytesFreed)} freed)` : 'no duplicate files'}${r.versionsConverted ? `, ${r.versionsConverted} old version${r.versionsConverted === 1 ? '' : 's'} converted` : ''}.`
          : 'Nothing to tidy: everything is already stored once.',
      );
    } catch (e) {
      toast(`Couldn’t tidy: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  const percent = report ? savedPercent(report) : 0;
  return (
    <Section title="Storage">
      <p>
        Every picture and every box of page history is kept once, however many pages or versions use it. Adding the same picture again, or editing one box of a page, adds almost nothing.
      </p>
      {report && (
        <>
          <div className="storage-lines">
            {reportLines(report).map((l) => (
              <div key={l.label} className="storage-line">
                <span className="storage-label">{l.label}</span>
                <span className="storage-value">{l.value}</span>
                <span className={'storage-saved' + (l.saved ? ' on' : '')}>{l.saved ? `${l.saved} saved by sharing` : ''}</span>
                <span className="storage-note">{l.note}</span>
              </div>
            ))}
          </div>
          {percent > 0 && <p className="storage-total">Altogether this takes {percent}% less room than keeping a copy for every use.</p>}
          {report.pending > 0 && <p>{report.pending} item{report.pending === 1 ? ' is' : 's are'} from an earlier version and not shared yet. The app does this in the background; <strong>Tidy now</strong> does it straight away.</p>}
        </>
      )}
      <div className="row start">
        <button className="btn" disabled={busy} onClick={() => void tidy()}>
          Tidy now
        </button>
      </div>
    </Section>
  );
}

/* ---------------- About ---------------- */

import { shortcutGroups } from '../../lib/shortcuts';
import { reportLines, savedPercent } from '../../lib/storageReport';
import { formatSize } from '../../lib/media';
import type { StorageReport } from '../../storage/types';
import { DEFAULT_KEYMAP, isDefaultKeymap, KEY_ACTIONS, setKey, type KeyAction } from '../../lib/keymap';

/** The one-letter keys on a page, each with a button to change it: press the button, then the new letter. */
const CREDITS: [string, string][] = [
  ['Tauri', 'MIT / Apache-2.0'],
  ['React', 'MIT'],
  ['TipTap and ProseMirror', 'MIT'],
  ['Excalidraw', 'MIT'],
  ['SQLite', 'Public domain'],
  ['PDF.js', 'Apache-2.0'],
  ['Zustand and Immer', 'MIT'],
  ['DOMPurify', 'Apache-2.0 / MPL-2.0'],
  ['fflate, idb, Turndown, html-to-image', 'MIT / ISC'],
  ['Onest and JetBrains Mono fonts', 'SIL Open Font License'],
];

function QuickKeys() {
  const keymap = usePrefs((s) => s.keymap);
  const [editing, setEditing] = useState<KeyAction | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!editing) return;
    // Captured before the dialog sees it, so Esc cancels the change instead of closing Settings.
    const onKey = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setEditing(null);
        setError('');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const m = /^Key([A-Z])$/.exec(e.code);
      const r = setKey(keymap, editing, m ? m[1] : e.key);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setKeymap(r.map, getStorage());
      setEditing(null);
      setError('');
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [editing, keymap]);
  return (
    <div className="quickkeys">
      <h4 className="kv-title">One-letter keys (click one to change it)</h4>
      <div className="quickkeys-grid">
        {KEY_ACTIONS.map((a) => (
          <span key={a.id} className="quickkey">
            <button
              className={'btn quickkey-btn' + (editing === a.id ? ' on' : '')}
              aria-label={`${a.label}: ${keymap[a.id]}. Change`}
              onClick={() => {
                setError('');
                setEditing(editing === a.id ? null : a.id);
              }}
            >
              {editing === a.id ? 'Press a letter…' : keymap[a.id]}
            </button>
            <span>{a.label}</span>
          </span>
        ))}
      </div>
      {error && <p className="quickkeys-error" role="alert">{error}</p>}
      {!isDefaultKeymap(keymap) && (
        <button className="btn" onClick={() => setKeymap(DEFAULT_KEYMAP, getStorage())}>
          Reset to the usual keys
        </button>
      )}
    </div>
  );
}

function AboutTab() {
  const keymap = usePrefs((s) => s.keymap);
  return (
    <>
      <Section title="Privacy">
        <p>Your notes stay on your devices. Nothing is sent over the internet unless you switch on an AI add-on and press Send on a preview of exactly what leaves. Sync runs directly between your own devices, encrypted with a code that never crosses the network.</p>
      </Section>
      <Section title="Built with">
        <ul className="credits">
          {CREDITS.map(([name, licence]) => (
            <li key={name}>
              <span>{name}</span>
              <span className="muted">{licence}</span>
            </li>
          ))}
        </ul>
      </Section>
      {!COARSE && (
      <Section title="Keyboard shortcuts">
        <p className="muted">Press <kbd>?</kbd> on a page to see this list there.</p>
        <QuickKeys />
        {shortcutGroups(keymap).map((g) => (
          <div key={g.title} className="kv">
            <h4 className="kv-title">{g.title}</h4>
            {g.rows.map(([k, v]) => (
              <span key={k} className="kv-row">
                <kbd>{k}</kbd>
                <span>{v}</span>
              </span>
            ))}
          </div>
        ))}
      </Section>
      )}
    </>
  );
}
