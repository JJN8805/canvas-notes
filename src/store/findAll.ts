import { create } from 'zustand';
import { findEverywhere, type FoundPage } from '../lib/findAll';
import { getStorage } from './notes';

/** The "Find in every workspace" dialog: closed (query null), or open with the last results. Pages are read from storage when you search, not kept. */
export const useFindAll = create<{ query: string | null; results: FoundPage[]; busy: boolean }>(() => ({ query: null, results: [], busy: false }));

export const openFindAll = (query = '') => {
  useFindAll.setState({ query, results: [], busy: false });
  if (query.trim()) void runFindAll(query);
};
export const closeFindAll = () => useFindAll.setState({ query: null, results: [], busy: false });

let latest = 0;
export async function runFindAll(query: string): Promise<void> {
  const mine = ++latest;
  useFindAll.setState({ query, busy: true });
  const { pages } = await getStorage().loadAll();
  if (mine !== latest) return; // a newer search started meanwhile
  useFindAll.setState({ results: findEverywhere(pages, query), busy: false });
}
