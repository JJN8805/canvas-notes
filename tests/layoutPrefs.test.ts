import { describe, expect, it } from 'vitest';
import { parseLayout } from '../src/lib/layoutPrefs';

describe('which side panels are open', () => {
  it('starts with everything open, as the app has always looked', () => {
    expect(parseLayout(null)).toEqual({ sidebar: true, cardTree: true });
    expect(parseLayout('')).toEqual({ sidebar: true, cardTree: true });
    expect(parseLayout('{}')).toEqual({ sidebar: true, cardTree: true });
  });
  it('remembers a panel that was closed, independently of the other', () => {
    expect(parseLayout('{"sidebar":false}')).toEqual({ sidebar: false, cardTree: true });
    expect(parseLayout('{"sidebar":true,"cardTree":false}')).toEqual({ sidebar: true, cardTree: false });
  });
  it('treats anything unreadable as open, never as closed', () => {
    expect(parseLayout('not json')).toEqual({ sidebar: true, cardTree: true });
    expect(parseLayout('[1,2]')).toEqual({ sidebar: true, cardTree: true });
    expect(parseLayout('{"sidebar":"no","cardTree":0}')).toEqual({ sidebar: true, cardTree: true });
    expect(parseLayout('null')).toEqual({ sidebar: true, cardTree: true });
  });
});
