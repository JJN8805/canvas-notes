import { create } from 'zustand';

/** The drawing box currently open for editing, if any (see DrawOverlay). */
export const useDraw = create<{ editing: { pageId: string; blockId: string } | null }>(() => ({ editing: null }));

export const openDraw = (pageId: string, blockId: string) => useDraw.setState({ editing: { pageId, blockId } });
export const closeDraw = () => useDraw.setState({ editing: null });
