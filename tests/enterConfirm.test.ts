import { describe, expect, it } from 'vitest';
import { confirmsOnEnter } from '../src/lib/enterConfirm';

const k = (o: Partial<Parameters<typeof confirmsOnEnter>[0]> = {}) => confirmsOnEnter({ key: 'Enter', tag: 'DIV', ...o });

describe('Enter as the main button of a dialog', () => {
  it('confirms from empty space and from a one-line field', () => {
    expect(k()).toBe(true);
    expect(k({ tag: 'INPUT', inputType: 'text' })).toBe(true);
    expect(k({ tag: 'INPUT', inputType: 'search' })).toBe(true);
  });
  it('leaves Enter alone where it has its own job', () => {
    for (const tag of ['TEXTAREA', 'BUTTON', 'SELECT', 'A', 'SUMMARY']) expect(k({ tag }), tag).toBe(false);
    expect(k({ editable: true })).toBe(false);
    expect(k({ tag: 'INPUT', inputType: 'checkbox' })).toBe(false);
  });
  it('Ctrl or Cmd+Enter confirms from a text box too, but never presses over a button', () => {
    expect(k({ tag: 'TEXTAREA', ctrl: true })).toBe(true);
    expect(k({ editable: true, meta: true })).toBe(true);
    expect(k({ tag: 'BUTTON', ctrl: true })).toBe(false);
  });
  it('ignores other keys, Shift+Enter, input-method composing and a key already handled', () => {
    expect(k({ key: 'a' })).toBe(false);
    expect(k({ shift: true })).toBe(false);
    expect(k({ composing: true })).toBe(false);
    expect(k({ defaultPrevented: true, tag: 'INPUT', inputType: 'text' })).toBe(false);
  });
});
