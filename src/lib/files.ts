/** Which stored files (pictures, audio, PDFs) a block uses. Sync, backup, clean-up and export all ask here, so a new kind of file box only needs adding once. */
import type { Block } from '../types';

export const fileIdOf = (b: Block): string | null => {
  if (b.type === 'image') return b.imageId || null;
  if (b.type === 'audio' || b.type === 'pdf') return b.fileId || null;
  return null;
};

/** Ids of every stored file the blocks use, without repeats. */
export const fileIdsOf = (blocks: readonly Block[]): string[] => [...new Set(blocks.map(fileIdOf).filter((id): id is string => !!id))];
