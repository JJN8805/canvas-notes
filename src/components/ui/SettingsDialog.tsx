import { useEffect, useMemo, useRef } from 'react';
import { chooseDailyTemplate, useNotes } from '../../store/notes';
import { usePrefs } from '../../store/prefs';
import { closeSettings, useSettingsUi } from '../../store/settingsUi';
import { resolveDailyTemplate, templatesOf } from '../../lib/pages';

export function SettingsDialog() {
  const open = useSettingsUi((s) => s.open);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const pages = useNotes((s) => s.pages);
  const setting = usePrefs((s) => s.dailyTemplate);
  const templates = useMemo(() => templatesOf(pages), [pages]);
  const current = resolveDailyTemplate(pages, setting)?.id ?? 'none';
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
        <section>
          <h3>Daily page</h3>
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
          <p>A daily page is only created when you open that day, never in the background. This is remembered on this computer.</p>
        </section>
        <div className="row">
          <button ref={closeRef} className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
