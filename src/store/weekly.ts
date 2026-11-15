import { create } from 'zustand';
import { dateKey } from '../lib/daily';
import { createPage } from './notes';
import { buildWeekly, weeklyBlocks, type WeeklyDraft } from '../lib/weekly';
import type { Page } from '../types';

/** The week whose review is on show (any date in it), or null. */
export const useWeekly = create<{ date: string | null }>(() => ({ date: null }));
export const openWeekly = (date: string = dateKey()) => useWeekly.setState({ date });
export const closeWeekly = () => useWeekly.setState({ date: null });

/** Turns a draft into a real page (the only place a weekly review is saved). */
export function createWeeklyPage(draft: WeeklyDraft): Page {
  return createPage({ title: draft.title, blocks: weeklyBlocks(draft) });
}

export { buildWeekly };
