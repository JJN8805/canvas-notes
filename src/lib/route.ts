import { useSyncExternalStore } from 'react';
import { parseRoute, type Route } from './routeParse';

export type { Route };

const parse = (): Route => parseRoute(location.search, location.hash);

let current = parse();

/** The route right now, for code that isn't a component. */
export const currentRoute = (): Route => current;
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parse();
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function navigate(to: Route) {
  if (to.name === 'widget') return; // a widget is its own window, never navigated to
  const hash = to.name === 'page' ? `#/page/${to.id}` : '#/';
  if (location.hash !== hash) location.hash = hash;
}
