import { create } from 'zustand';

/** The page whose "Tidy this page" proposal is on show, or null. */
export const useTidy = create<{ pageId: string | null }>(() => ({ pageId: null }));
export const openTidy = (pageId: string) => useTidy.setState({ pageId });
export const closeTidy = () => useTidy.setState({ pageId: null });
