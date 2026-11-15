import { useEffect, useRef } from 'react';
import { closeShortcuts, useShortcutsSheet } from '../../store/shortcutsUi';
import { shortcutGroups } from '../../lib/shortcuts';
import { usePrefs } from '../../store/prefs';

/** Every shortcut at a glance, opened with `?` (Miro, Figma, Gmail and GitHub all do this). Esc or a click outside closes it. */
export function ShortcutsSheet() {
  const open = useShortcutsSheet((s) => s.open);
  const keymap = usePrefs((s) => s.keymap);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        closeShortcuts();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeShortcuts()}>
      <div className="dialog shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="shortcuts-head">
          <h2>Keyboard shortcuts</h2>
          <button ref={close} className="btn" onClick={closeShortcuts}>
            Close
          </button>
        </div>
        <div className="shortcuts-cols">
          {shortcutGroups(keymap).map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <div className="kv">
                {g.rows.map(([k, v]) => (
                  <span key={k} className="kv-row">
                    <kbd>{k}</kbd>
                    <span>{v}</span>
                  </span>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
