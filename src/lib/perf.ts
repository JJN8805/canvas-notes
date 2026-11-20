/**
 * A small timing log for tracking down stalls ("it froze for a few seconds"). Off unless `localStorage.debugPerf = '1'` (or a dev build):
 * it names what ran just before any main-thread task that blocked the window for 150 ms or more, so a freeze can be pinned on a job
 * instead of guessed at. Nothing is stored or sent; it only writes to the console.
 */
const recent: { label: string; at: number; ms: number }[] = [];
let on: boolean | null = null;

export function perfEnabled(): boolean {
  if (on === null) {
    try {
      on = !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV || window.localStorage.getItem('debugPerf') === '1';
    } catch {
      on = false;
    }
  }
  return on;
}

/** Times an async or sync job under a label (a no-op wrapper when the log is off). */
export function timed<T>(label: string, fn: () => T): T {
  if (!perfEnabled()) return fn();
  const t = performance.now();
  const done = () => {
    recent.push({ label, at: t, ms: performance.now() - t });
    if (recent.length > 30) recent.shift();
  };
  const r = fn();
  if (r instanceof Promise) return r.finally(done) as T;
  done();
  return r;
}

/** Starts reporting long tasks, with the jobs that were running around them. Safe to call more than once. */
let started = false;
export function startPerfLog(): void {
  if (started || !perfEnabled() || typeof PerformanceObserver === 'undefined') return;
  started = true;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < 150) continue;
        const near = recent.filter((r) => r.at < e.startTime + e.duration && r.at + r.ms > e.startTime - 50).map((r) => `${r.label} ${Math.round(r.ms)}ms`);
        console.warn(`[perf] the window was blocked for ${Math.round(e.duration)} ms`, near.length ? `while: ${near.join(', ')}` : '(no timed job around it)');
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* long-task timing is not available here */
  }
}
