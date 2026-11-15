import { describe, expect, it } from 'vitest';
import { autostartBlockedReason } from '../src/widgets/host';

describe('start at login', () => {
  it('is refused for a development build, with a reason a person can act on', () => {
    expect(autostartBlockedReason(true)).toMatch(/development build/);
    expect(autostartBlockedReason(false)).toBeNull();
  });
});
