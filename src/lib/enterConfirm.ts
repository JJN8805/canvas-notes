/**
 * Enter as the dialog's main button ("Done", "Apply", "Create"). Pure: the rule for when a key press counts.
 * Enter does its own job in a multi-line box, a rich text box, a button, a list or a link, so it only confirms from a plain
 * one-line field or from empty space in the dialog; Ctrl/Cmd+Enter confirms from anywhere, including a text box.
 * A key already handled below (a tag field adding its tag) or typed while composing text (an input method) never confirms.
 */
export interface EnterKey {
  key: string;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  composing?: boolean;
  defaultPrevented?: boolean;
  /** Upper-case tag name of where the key was pressed. */
  tag: string;
  editable?: boolean;
  /** For an input: its `type`. */
  inputType?: string;
}

const OWN_ENTER = new Set(['TEXTAREA', 'BUTTON', 'SELECT', 'A', 'SUMMARY']);
const OWN_INPUT = new Set(['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color']);

export function confirmsOnEnter(k: EnterKey): boolean {
  if (k.key !== 'Enter' || k.shift || k.composing || k.defaultPrevented) return false;
  if (k.tag === 'BUTTON' || k.tag === 'A' || k.tag === 'SUMMARY') return false; // Enter presses it
  if (k.ctrl || k.meta) return true;
  if (OWN_ENTER.has(k.tag) || k.editable) return false;
  if (k.tag === 'INPUT' && OWN_INPUT.has(k.inputType ?? 'text')) return false;
  return true;
}

/** `confirmsOnEnter` for a React key event. */
export const enterKey = (e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; defaultPrevented: boolean; nativeEvent: KeyboardEvent; target: EventTarget }): EnterKey => {
  const t = e.target as HTMLElement;
  return {
    key: e.key,
    shift: e.shiftKey,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    composing: e.nativeEvent.isComposing,
    defaultPrevented: e.defaultPrevented,
    tag: t.tagName ?? '',
    editable: t.isContentEditable,
    inputType: t instanceof HTMLInputElement ? t.type : undefined,
  };
};
