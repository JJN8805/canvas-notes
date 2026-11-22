import { create } from 'zustand';
import { cleanGraphPrefs, type GraphPrefs } from '../lib/graphPrefs';

const KEY = 'ui.graph';

function load(): GraphPrefs {
  try {
    const saved = localStorage.getItem(KEY);
    // On a phone the settings strip would cover the picture, so it starts closed (the Settings button opens it).
    if (saved === null && typeof window !== 'undefined' && window.innerWidth <= 760) return { ...cleanGraphPrefs(null), panelOpen: false };
    return cleanGraphPrefs(JSON.parse(saved ?? 'null'));
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
