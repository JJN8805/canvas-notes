import { create } from 'zustand';
import type { Point } from './canvas';

/** The "/" insert menu: where it is on screen, and where on the page the new box goes. */
export interface SlashState {
  open: { pageId: string; screen: Point; world: Point; focus: (id: string) => void } | null;
}
export const useSlash = create<SlashState>(() => ({ open: null }));
export const openSlash = (open: NonNullable<SlashState['open']>) => useSlash.setState({ open });
export const closeSlash = () => useSlash.setState({ open: null });
