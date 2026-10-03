import { useSyncExternalStore } from 'react';

export type Route = { name: 'library' } | { name: 'page'; id: string };

function parse(): Route {
  const m = location.hash.match(/^#\/page\/([\w-]+)/);
  return m ? { name: 'page', id: m[1] } : { name: 'library' };
}

let current = parse();
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
  const hash = to.name === 'page' ? `#/page/${to.id}` : '#/';
  if (location.hash !== hash) location.hash = hash;
}
