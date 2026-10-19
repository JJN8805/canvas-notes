import { create } from 'zustand';

/** Whether the page is in draw mode, with Excalidraw laid over the whole canvas (see DrawOverlay). */
export const useDraw = create<{ open: boolean }>(() => ({ open: false }));

export const openDraw = () => useDraw.setState({ open: true });
export const closeDraw = () => useDraw.setState({ open: false });
export const toggleDraw = () => useDraw.setState((s) => ({ open: !s.open }));
