import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { closeDialog, closeMenu, dismissToast, useUi, type MenuItem } from '../../store/ui';
import { GROUP_COLORS, NOTE_COLORS } from '../../types';
import { colorVar } from '../../lib/util';

export function Overlays() {
  return (
    <>
      <MenuHost />
      <DialogHost />
      <ToastHost />
    </>
  );
}

function MenuHost() {
  const menu = useUi((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const r = menu.anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    let left = r.right - m.width;
    let top = r.bottom + 4;
    if (left < 8) left = Math.min(r.left, window.innerWidth - m.width - 8);
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, r.top - m.height - 4);
    setPos({ left: Math.max(8, left), top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenu();
        menu.anchor.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const buttons = Array.from(ref.current?.querySelectorAll('button') ?? []);
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  if (!menu) return null;
  const run = (fn: () => void) => {
    closeMenu();
    fn();
  };
  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
    >
      {menu.items.map((it: MenuItem, i) => {
        if ('separator' in it) return <div key={i} className="menu-sep" />;
        if ('heading' in it) return <div key={i} className="menu-head">{it.heading}</div>;
        if ('colors' in it) {
          return (
            <div key={i}>
              <div className="menu-head">{it.title ?? 'Color'}</div>
              <div className="swatches">
                <button
                  className="swatch swatch-none"
                  aria-label="No color"
                  title="None"
                  aria-pressed={it.current === null}
                  onClick={() => run(() => it.pick(null))}
                />
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    className="swatch"
                    style={{ background: colorVar(c) }}
                    aria-label={c}
                    title={c}
                    aria-pressed={it.current === c}
                    onClick={() => run(() => it.pick(c))}
                  />
                ))}
              </div>
            </div>
          );
        }
        if ('swatches' in it) {
          return (
            <div key={i}>
              <div className="menu-head">{it.title ?? 'Color'}</div>
              <div className="swatches">
                {GROUP_COLORS.map((c) => (
                  <button
                    key={c}
                    className="swatch"
                    style={{ background: colorVar(c) }}
                    aria-label={c}
                    aria-pressed={it.current === c}
                    onClick={() => run(() => it.pick(c))}
                  />
                ))}
              </div>
            </div>
          );
        }
        return (
          <button key={i} role="menuitem" className={'menu-item' + (it.danger ? ' danger' : '')} onClick={() => run(it.action)}>
            {it.dot && <span className="dot" style={{ background: colorVar(it.dot) }} />}
            {it.label}
            {it.check && <span className="check">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

function DialogHost() {
  const dialog = useUi((s) => s.dialog);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const prevFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!dialog) return;
    prevFocus.current = document.activeElement;
    setValue(dialog.input ?? '');
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      } else okRef.current?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  if (!dialog) return null;
  const isPrompt = dialog.input !== undefined;
  function close(v: string | boolean | null) {
    closeDialog(v);
    (prevFocus.current as HTMLElement | null)?.focus?.();
  }
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close(null)}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        onSubmit={(e) => {
          e.preventDefault();
          close(isPrompt ? value : true);
        }}
      >
        <h2>{dialog.title}</h2>
        {dialog.text && <p>{dialog.text}</p>}
        {isPrompt && (
          <input
            ref={inputRef}
            className="field"
            value={value}
            placeholder={dialog.placeholder}
            maxLength={200}
            onChange={(e) => setValue(e.target.value)}
            aria-label={dialog.title}
          />
        )}
        <div className="row">
          <button type="button" className="btn" onClick={() => close(null)}>
            Cancel
          </button>
          <button ref={okRef} type="submit" className={'btn ' + (dialog.danger ? 'danger' : 'primary')}>
            {dialog.okLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function ToastHost() {
  const toasts = useUi((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
