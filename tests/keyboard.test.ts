import { describe, expect, it } from 'vitest';
import { isEditableTarget, isTextEntry } from '../src/lib/util';

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as Element;

describe('which focused elements take typed text', () => {
  it('treats text fields as text entry', () => {
    for (const e of [el('TEXTAREA'), el('INPUT', { type: 'text' }), el('SELECT'), el('DIV', { isContentEditable: true })]) {
      expect(isEditableTarget(e)).toBe(true);
      expect(isTextEntry(e)).toBe(true);
    }
  });

  it('does not treat a focused checkbox or slider as text entry, so undo still reaches the canvas', () => {
    for (const type of ['checkbox', 'radio', 'range', 'button']) {
      const e = el('INPUT', { type });
      expect(isEditableTarget(e)).toBe(true);
      expect(isTextEntry(e)).toBe(false);
    }
  });

  it('is false for nothing and for plain elements', () => {
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(el('BUTTON'))).toBe(false);
  });
});
