import { create } from 'zustand';
import { toggleId } from '../lib/selection';

/** Picking several pages in the library to archive, move or delete together. Not remembered: it is for one sitting. */
export const useSelect = create<{ on: boolean; ids: string[] }>(() => ({ on: false, ids: [] }));

export const startSelect = (id?: string) => useSelect.setState({ on: true, ids: id ? [id] : [] });
export const toggleSelected = (id: string) => useSelect.setState((s) => ({ on: true, ids: toggleId(s.ids, id) }));
export const selectAllOf = (ids: string[]) => useSelect.setState({ on: true, ids });
export const cancelSelect = () => useSelect.setState({ on: false, ids: [] });
