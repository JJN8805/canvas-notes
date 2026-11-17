import { create } from 'zustand';

export interface RagStatus {
  /** off = not running (switched off, or no model chosen); idle = up to date; indexing = working; error = stopped with a message. */
  state: 'off' | 'idle' | 'indexing' | 'error';
  model: string;
  /** Passages with a current vector, and how many there are in all. */
  done: number;
  total: number;
  error: string;
  /** Why it is off, in words. */
  note: string;
}

export const useRagStatus = create<RagStatus>(() => ({ state: 'off', model: '', done: 0, total: 0, error: '', note: '' }));
export const setRagStatus = (p: Partial<RagStatus>) => useRagStatus.setState(p);
