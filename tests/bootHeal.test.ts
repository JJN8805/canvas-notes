import { describe, expect, it } from 'vitest';
import { HEAL_WINDOW_MS, MAX_HEALS, isModuleLoadFailure, nextHeal, parseHealState, type HealState } from '../src/lib/bootHeal';

describe('recognising a script that would not load', () => {
  it('knows the wording of each browser', () => {
    for (const m of ['Importing a module script failed.', 'Failed to fetch dynamically imported module: http://x/y.js', 'error loading dynamically imported module', '504 Outdated Optimize Dep']) expect(isModuleLoadFailure(m)).toBe(true);
  });
  it('leaves other failures alone', () => {
    for (const m of ['no such table: pages', 'Storage is not ready', '', null, undefined, 42]) expect(isModuleLoadFailure(m)).toBe(false);
  });
});

describe('reloading by itself, a few times', () => {
  it('reloads after a growing pause and counts the tries', () => {
    let s: HealState | null = null;
    const delays: number[] = [];
    for (let i = 0; i < MAX_HEALS; i++) {
      const n = nextHeal(s, 1000 + i * 2000);
      expect(n.reload).toBe(true);
      delays.push(n.delayMs);
      s = n.state;
    }
    expect(delays).toEqual([800, 1600, 2400, 3200]);
    expect(s!.tries).toBe(MAX_HEALS);
  });
  it('gives up after the limit, so a real fault shows its message instead of looping', () => {
    const n = nextHeal({ tries: MAX_HEALS, at: 5000 }, 6000);
    expect(n.reload).toBe(false);
  });
  it('starts over once the earlier attempts are old (a new incident)', () => {
    const n = nextHeal({ tries: MAX_HEALS, at: 0 }, HEAL_WINDOW_MS + 1);
    expect(n.reload).toBe(true);
    expect(n.state.tries).toBe(1);
  });
  it('reads a stored state safely', () => {
    expect(parseHealState('{"tries":2,"at":99}')).toEqual({ tries: 2, at: 99 });
    for (const bad of [null, '', 'x', '{}', '{"tries":"a","at":1}', '[]']) expect(parseHealState(bad as never)).toBeNull();
  });
});
