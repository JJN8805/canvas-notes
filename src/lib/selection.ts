/** Picking several pages in the library (pure): which ids are picked, and what an action applies to. */
export const toggleId = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

/** The picked ids that are still on screen, in the order they are listed (a page may have been deleted or filtered out since). */
export const pickedIn = (ids: readonly string[], shown: readonly string[]): string[] => {
  const set = new Set(ids);
  return shown.filter((id) => set.has(id));
};

/** "3 pages", "1 page". */
export const pagesWord = (n: number): string => `${n} page${n === 1 ? '' : 's'}`;
