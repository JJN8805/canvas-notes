import { create } from 'zustand';
import { parseLayout, type Layout } from '../lib/layoutPrefs';

const KEY = 'ui.layout';

function read(): Layout {
  try {
    return parseLayout(localStorage.getItem(KEY));
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
