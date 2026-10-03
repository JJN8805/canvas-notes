import { create } from 'zustand';
import type { GroupColor } from '../types';

export interface ToastMsg {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export interface DialogReq {
  id: number;
  title: string;
  text?: string;
  /** When set, the dialog shows a text field with this initial value. */
  input?: string;
  placeholder?: string;
  okLabel: string;
  danger?: boolean;
  resolve: (v: string | boolean | null) => void;
}

export type MenuItem =
  | { label: string; action: () => void; danger?: boolean; check?: boolean; dot?: GroupColor }
  | { heading: string }
  | { separator: true }
  | { swatches: true; current: GroupColor; pick: (c: GroupColor) => void };

export interface MenuReq {
  anchor: HTMLElement;
  items: MenuItem[];
}

interface UiState {
  toasts: ToastMsg[];
  dialog: DialogReq | null;
  menu: MenuReq | null;
}

export const useUi = create<UiState>(() => ({ toasts: [], dialog: null, menu: null }));

let seq = 0;

export function toast(message: string, action?: ToastMsg['action'], ms = 4500) {
  const id = ++seq;
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, action }] }));
  window.setTimeout(() => dismissToast(id), ms);
}
export function dismissToast(id: number) {
  useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function ask(opts: { title: string; initial?: string; placeholder?: string; okLabel: string; text?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    useUi.setState({
      dialog: {
        id: ++seq,
        title: opts.title,
        text: opts.text,
        input: opts.initial ?? '',
        placeholder: opts.placeholder,
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
export function closeMenu() {
  useUi.setState({ menu: null });
}
