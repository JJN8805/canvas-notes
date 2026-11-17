import { describe, expect, it } from 'vitest';
import { splitKeyHint } from '../src/components/ui/Overlays';

describe('menu labels with a key', () => {
  it('splits the key from the name', () => {
    expect(splitKeyHint('Duplicate  (Ctrl+D)')).toEqual({ text: 'Duplicate', key: 'Ctrl+D' });
    expect(splitKeyHint('Bring to front  (Ctrl+Shift+])')).toEqual({ text: 'Bring to front', key: 'Ctrl+Shift+]' });
  });
  it('leaves other labels as they are (a single space before a bracket is part of the name)', () => {
    expect(splitKeyHint('Delete')).toEqual({ text: 'Delete', key: '' });
    expect(splitKeyHint('Move (copy)')).toEqual({ text: 'Move (copy)', key: '' });
  });
});
