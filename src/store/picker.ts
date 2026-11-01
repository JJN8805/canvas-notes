import { create } from 'zustand';

/** Whether the "New page" template picker is showing. */
export const usePicker = create<{ open: boolean }>(() => ({ open: false }));

export const openTemplatePicker = () => usePicker.setState({ open: true });
export const closeTemplatePicker = () => usePicker.setState({ open: false });
