import { create } from 'zustand';

/** The card folder or section whose name and description are being edited right now (at most one), or null. */
export const useFolderEdit = create<{ id: string | null }>(() => ({ id: null }));
export const startFolderEdit = (id: string) => useFolderEdit.setState({ id });
export const stopFolderEdit = () => useFolderEdit.setState({ id: null });
