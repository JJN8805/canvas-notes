/** Turns the address into a route. Kept apart from `route.ts` so it can run (and be tested) without a window. */
import { isSafeId } from '../storage/validate';

export type Route = { name: 'library' } | { name: 'page'; id: string } | { name: 'widget'; pageId: string; blockId: string | null };

export function parseRoute(search: string, hash: string): Route {
  const q = new URLSearchParams(search);
  const widget = q.get('widget');
  if (widget !== null) {
    const block = q.get('block');
    // A widget window with a bad address shows the library rather than reaching for something odd.
    if (isSafeId(widget) && (block === null || isSafeId(block))) return { name: 'widget', pageId: widget, blockId: block };
  }
  const m = hash.match(/^#\/page\/([\w-]+)/);
  return m ? { name: 'page', id: m[1] } : { name: 'library' };
}
