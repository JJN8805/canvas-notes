import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/route', () => ({ navigate: () => {}, currentRoute: () => ({ name: 'library' }), useRoute: () => ({ name: 'library' }) }));
vi.mock('../src/store/ui', () => ({ toast: () => {}, openMenu: () => {}, ask: async () => null, useUi: { getState: () => ({}), setState: () => {} } }));

import { createCount, createItems } from '../src/components/library/createMenu';
import { useFeatures } from '../src/store/features';
import { useAddons } from '../src/addons/store';
import type { MenuItem } from '../src/store/ui';

const labels = () => createItems().filter((i): i is Extract<MenuItem, { label: string }> => 'label' in i).map((i) => i.label);

beforeEach(() => {
  useFeatures.setState({ disabled: [] } as never);
  useAddons.setState({ enabled: ['office'] } as never);
});

describe('the New menu', () => {
  it('offers everything that can be made, with the four Studio kinds grouped under a heading', () => {
    expect(labels()).toEqual(['Page', 'Card', 'Today in the journal', 'Document', 'Spreadsheet', 'Presentation', 'Script', 'More starters…', 'Group']);
    expect(createItems().some((i) => 'heading' in i && i.heading === 'Write or build')).toBe(true);
  });
  it('leaves out what is switched off, and Studio when the add-on is off', () => {
    useFeatures.setState({ disabled: ['cards', 'script', 'journal'] } as never);
    expect(labels()).toEqual(['Page', 'Document', 'Spreadsheet', 'Presentation', 'More starters…', 'Group']);
    useAddons.setState({ enabled: [] } as never);
    expect(labels()).toEqual(['Page', 'Group']);
    expect(createItems().some((i) => 'heading' in i)).toBe(false);
  });
  it('counts only real choices, so a copy with one choice skips the menu', () => {
    expect(createCount()).toBe(9);
    useFeatures.setState({ disabled: ['cards', 'journal', 'groups'] } as never);
    useAddons.setState({ enabled: [] } as never);
    expect(createCount()).toBe(1);
  });
});
