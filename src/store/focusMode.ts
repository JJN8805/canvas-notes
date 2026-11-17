import { create } from 'zustand';

/** Focus mode: a page with only the page (no header, tools, map or zoom). Not remembered: it is for one sitting. */
export const useFocusMode = create<{ on: boolean }>(() => ({ on: false }));
export const toggleFocusMode = () => useFocusMode.setState((s) => ({ on: !s.on }));
export const setFocusMode = (on: boolean) => useFocusMode.setState({ on });
