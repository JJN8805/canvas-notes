import { create } from 'zustand';
import { dateKey } from '../lib/daily';
import { splitGroups } from '../lib/workspaces';
import { todayEverywhere, type DeskToday } from '../lib/todayAll';
import { getStorage, get } from './notes';

/** The "Today, everywhere" dialog: closed (null) or showing what was read from every workspace when it was opened. */
export const useTodayAll = create<{ desks: DeskToday[] | null }>(() => ({ desks: null }));

/** Reads every page (not only the open workspace's) and opens the dialog. */
export async function openTodayAll(): Promise<void> {
  const { pages, groups } = await getStorage().loadAll();
  useTodayAll.setState({ desks: todayEverywhere(pages, splitGroups(groups, null).workspaces, get().mainName, dateKey()) });
}
export const closeTodayAll = () => useTodayAll.setState({ desks: null });
