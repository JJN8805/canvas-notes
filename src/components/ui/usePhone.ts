import { useSyncExternalStore } from 'react';
import { PHONE_QUERY } from '../../lib/phoneView';

const subscribe = (cb: () => void) => {
  if (typeof matchMedia === 'undefined') return () => {};
  const m = matchMedia(PHONE_QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
const snapshot = () => typeof matchMedia !== 'undefined' && matchMedia(PHONE_QUERY).matches;

/** True in a narrow window (a phone): the layout switches to bottom tabs, a compact page header and bigger touch targets. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
