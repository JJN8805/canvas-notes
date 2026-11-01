import { create } from 'zustand';

/** Whether the Settings dialog is showing. */
export const useSettingsUi = create<{ open: boolean }>(() => ({ open: false }));

export const openSettings = () => useSettingsUi.setState({ open: true });
export const closeSettings = () => useSettingsUi.setState({ open: false });
