/** The pages of the other workspaces and their names: what a link can lead to besides the pages on screen. Kept apart from the workspace actions so it loads without the window's address. */
import { useMemo } from 'react';
import type { Others } from '../lib/boxLinks';
import { listWorkspaces } from '../lib/workspaces';
import { get, useNotes } from './notes';

/** The pages of the other workspaces and their names, for resolving and offering links that cross workspaces. */
export function useOthers(): Others {
  const stubs = useNotes((s) => s.elsewhere);
  const rows = useNotes((s) => s.workspaces);
  const mainName = useNotes((s) => s.mainName);
  const list = useMemo(() => listWorkspaces(rows, mainName), [rows, mainName]);
  return useMemo(() => ({ stubs, nameOf: (id: string) => list.find((w) => w.id === id)?.name ?? id }), [stubs, list]);
}

/** The same, read once (for code that is not a component). */
export const othersNow = (): Others => {
  const st = get();
  const list = listWorkspaces(st.workspaces, st.mainName);
  return { stubs: st.elsewhere, nameOf: (id) => list.find((w) => w.id === id)?.name ?? id };
};

