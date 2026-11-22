import { create } from 'zustand';
import type { GroupColor, NoteColor } from '../types';
import type { IconName } from '../components/ui/Icon';

export interface ToastMsg {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  /** The page this toast is about. Leaving the page removes it, so its Undo can never act on a page that is not on screen. */
  owner?: string;
}

export interface DialogReq {
  id: number;
  title: string;
  text?: string;
  /** When set, the dialog shows a text field with this initial value. */
  input?: string;
  placeholder?: string;
  /** Show the dialog's text field as a password field. */
  secret?: boolean;
  okLabel: string;
  danger?: boolean;
  resolve: (v: string | boolean | null) => void;
}

export type MenuItem =
  | { label: string; action: () => void; danger?: boolean; check?: boolean; dot?: GroupColor; /** A picture for it; without one, a picture is chosen by what the words mean (`lib/menuIcons.ts`). */ icon?: IconName | null }
  | { heading: string }
  | { separator: true }
  | { swatches: true; title?: string; current: string; pick: (c: GroupColor) => void }
  /** The note colours, plus "None" (null). */
  | { colors: true; title?: string; current: NoteColor | null; pick: (c: NoteColor | null) => void };

export interface MenuReq {
  anchor: HTMLElement;
  items: MenuItem[];
  /** Screen position for a right-click menu: it opens with its corner here instead of under the anchor. */
  at?: { x: number; y: number };
}

interface UiState {
  toasts: ToastMsg[];
  dialog: DialogReq | null;
  menu: MenuReq | null;
}

export const useUi = create<UiState>(() => ({ toasts: [], dialog: null, menu: null }));

let seq = 0;

export function toast(message: string, action?: ToastMsg['action'], ms = 4500, owner?: string) {
  const id = ++seq;
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, action, owner }] }));
  window.setTimeout(() => dismissToast(id), ms);
}
/** Removes the toasts that belong to a page (called when the page is left). */
export function dismissToastsOwnedBy(owner: string) {
  useUi.setState((s) => (s.toasts.some((t) => t.owner === owner) ? { toasts: s.toasts.filter((t) => t.owner !== owner) } : s));
}
export function dismissToast(id: number) {
  useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function ask(opts: { title: string; initial?: string; placeholder?: string; okLabel: string; text?: string; secret?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    useUi.setState({
      dialog: {
        id: ++seq,
        title: opts.title,
        text: opts.text,
        input: opts.initial ?? '',
        placeholder: opts.placeholder,
        secret: opts.secret,
        okLabel: opts.okLabel,
        resolve: (v) => resolve(typeof v === 'string' ? v : null),
      },
    });
  });
}

export function confirmDanger(title: string, text: string, okLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    useUi.setState({
      dialog: { id: ++seq, title, text, okLabel, danger: true, resolve: (v) => resolve(v === true) },
    });
  });
}

export function closeDialog(value: string | boolean | null) {
  const d = useUi.getState().dialog;
  useUi.setState({ dialog: null });
  d?.resolve(value);
}

export function openMenu(anchor: HTMLElement, items: MenuItem[]) {
  useUi.setState({ menu: { anchor, items } });
}
/** A right-click menu: opens at the pointer; `anchor` only gets the focus back when it closes. */
export function openMenuAt(anchor: HTMLElement, x: number, y: number, items: MenuItem[]) {
  useUi.setState({ menu: { anchor, items, at: { x, y } } });
}
export function closeMenu() {
  useUi.setState({ menu: null });
}
