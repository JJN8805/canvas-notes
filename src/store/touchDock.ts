import { create } from 'zustand';

/** Where the selected box's action bar goes on a touch screen: a fixed strip at the bottom of the page (the thumb's reach), set by the editor. */
export const useTouchDock = create<{ el: HTMLElement | null }>(() => ({ el: null }));
export const setTouchDock = (el: HTMLElement | null) => useTouchDock.setState({ el });
