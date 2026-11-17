import { create } from 'zustand';
import { cleanGraphPrefs, type GraphPrefs } from '../lib/graphPrefs';

const KEY = 'ui.graph';

function load(): GraphPrefs {
  try {
    return cleanGraphPrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return cleanGraphPrefs(null); // private window, blocked storage: the defaults
  }
}

export const useGraphPrefs = create<GraphPrefs>(() => load());

export function setGraphPrefs(patch: Partial<GraphPrefs>) {
  const next = cleanGraphPrefs({ ...useGraphPrefs.getState(), ...patch });
  useGraphPrefs.setState(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* not saved; still applied for this session */
  }
}
