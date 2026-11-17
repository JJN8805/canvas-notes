import { create } from 'zustand';

/** Which navigation overlay is open: the command palette (Ctrl+P), the quick switcher (Ctrl+O), the page outline, the link graph, or a page in 3D. */
export type NavOverlay = 'commands' | 'switcher' | 'outline' | 'graph' | 'space' | null;

export const useNav = create<{ open: NavOverlay }>(() => ({ open: null }));

export const openNav = (open: Exclude<NavOverlay, null>) => useNav.setState({ open });
export const closeNav = () => useNav.setState({ open: null });
