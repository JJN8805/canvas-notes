/** Which stored files (pictures, audio, PDFs) a block uses. Sync, backup, clean-up and export all ask here, so a new kind of file box only needs adding once. */
import type { Block } from '../types';

export const fileIdOf = (b: Block): string | null => {
  if (b.type === 'image') return b.imageId || null;
  if (b.type === 'audio' || b.type === 'pdf') return b.fileId || null;
  return null;
};

/** Every stored file a page uses: the files in its boxes and its cover picture. Sync, backup and clean-up all ask here. */
export const pageFileIds = (p: { blocks: readonly Block[]; cover?: string | null }): string[] => [...new Set([...fileIdsOf(p.blocks), ...(p.cover ? [p.cover] : [])])];

/** Ids of every stored file the blocks use, without repeats. */
export const fileIdsOf = (blocks: readonly Block[]): string[] => [...new Set(blocks.map(fileIdOf).filter((id): id is string => !!id))];
