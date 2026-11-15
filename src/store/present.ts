import { create } from 'zustand';

/** The full-screen show: which page and which slide (by position), or null when no show is running. */
export const usePresent = create<{ show: { pageId: string; index: number } | null }>(() => ({ show: null }));

/** Start the show. Call it from a click: full screen can only be asked for while handling one. The show works the same in a window if it is refused. */
export function startPresent(pageId: string, index = 0) {
  void document.documentElement.requestFullscreen?.().catch(() => {});
  usePresent.setState({ show: { pageId, index } });
}
export const stopPresent = () => usePresent.setState({ show: null });
export const goToSlide = (index: number) => usePresent.setState((s) => (s.show ? { show: { ...s.show, index } } : s));
