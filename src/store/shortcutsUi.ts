import { create } from 'zustand';

/** Whether the keyboard shortcut sheet (the `?` key) is open. */
export const useShortcutsSheet = create<{ open: boolean }>(() => ({ open: false }));
export const openShortcuts = () => useShortcutsSheet.setState({ open: true });
export const closeShortcuts = () => useShortcutsSheet.setState({ open: false });
