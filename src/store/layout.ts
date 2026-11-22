import { create } from 'zustand';
import { parseLayout, type Layout } from '../lib/layoutPrefs';

const KEY = 'ui.layout';

function read(): Layout {
  try {
    const saved = localStorage.getItem(KEY);
    // On a phone the folder tree would take a third of the screen, so it starts rolled up (the Folders button in the breadcrumb row opens it).
    if (saved === null && typeof window !== 'undefined' && window.innerWidth <= 760) return { ...parseLayout(null), cardTree: false };
    return parseLayout(saved);
  } catch {
    return parseLayout(null);
  }
}

/** Which side panels are open. A per-device convenience, so it lives in the browser's storage, not in the library. */
export const useLayout = create<Layout>(() => read());

function change(patch: Partial<Layout>) {
  useLayout.setState(patch);
  try {
    const { sidebar, cardTree } = useLayout.getState();
    localStorage.setItem(KEY, JSON.stringify({ sidebar, cardTree }));
  } catch {
    /* remembering the layout is a convenience */
  }
}

export const toggleSidebar = () => change({ sidebar: !useLayout.getState().sidebar });
export const toggleCardTree = () => change({ cardTree: !useLayout.getState().cardTree });
