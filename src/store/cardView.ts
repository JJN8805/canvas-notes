import { create } from 'zustand';

/** The card whose details are open over the page (a card box on a page was clicked). Shown by `CardViewHost`, outside the canvas. */
export const useCardView = create<{ id: string | null }>(() => ({ id: null }));

export const openCard = (id: string) => useCardView.setState({ id });
export const closeCard = () => useCardView.setState({ id: null });
