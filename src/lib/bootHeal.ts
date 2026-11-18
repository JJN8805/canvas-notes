/**
 * When the window cannot load a piece of its own code (the dev server restarted or was still bundling), reloading fixes it. Pure rules for
 * doing that by itself, a few times, instead of leaving "Your notes couldn't be opened" on screen.
 */
export const MAX_HEALS = 4;
/** Attempts further apart than this are separate incidents, not a loop. */
export const HEAL_WINDOW_MS = 60_000;

/** Whether a failure message is the browser failing to load a script (WebKit, Chrome and Firefox word it differently). */
export const isModuleLoadFailure = (message: unknown): boolean =>
  typeof message === 'string' && /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Outdated Optimize Dep/i.test(message);

export interface HealState {
  tries: number;
  at: number;
}

/** What to do after a load failure: reload again (after a growing pause), or give up and show the message. */
export function nextHeal(state: HealState | null, now: number): { reload: boolean; delayMs: number; state: HealState } {
  const fresh = !state || now - state.at > HEAL_WINDOW_MS;
  const tries = fresh ? 0 : state.tries;
  if (tries >= MAX_HEALS) return { reload: false, delayMs: 0, state: { tries, at: state!.at } };
  return { reload: true, delayMs: 800 * (tries + 1), state: { tries: tries + 1, at: fresh ? now : state!.at } };
}

export const parseHealState = (raw: string | null): HealState | null => {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<HealState> | null;
    return v && Number.isFinite(v.tries) && Number.isFinite(v.at) ? { tries: Math.max(0, Math.floor(v.tries!)), at: v.at! } : null;
  } catch {
    return null;
  }
};
