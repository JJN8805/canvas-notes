import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToastsOwnedBy, toast, useUi } from '../src/store/ui';

describe('toasts that belong to a page', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    useUi.setState({ toasts: [] });
  });
  it('leaving a page removes its toasts (so an Undo cannot act on a page that is not on screen) and keeps the others', () => {
    toast('Box deleted', { label: 'Undo', run: () => {} }, 60_000, 'page-a');
    toast('Saved', undefined, 60_000);
    toast('Box deleted', { label: 'Undo', run: () => {} }, 60_000, 'page-b');
    dismissToastsOwnedBy('page-a');
    expect(useUi.getState().toasts.map((t) => t.owner ?? '')).toEqual(['', 'page-b']);
  });
  it('changes nothing when the page owns none', () => {
    toast('Saved', undefined, 60_000);
    const before = useUi.getState().toasts;
    dismissToastsOwnedBy('nobody');
    expect(useUi.getState().toasts).toBe(before);
  });
});
