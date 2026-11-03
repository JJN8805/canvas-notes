import type { Block } from '../../types';
import type { AddOnModule, BlockAction } from '../types';
import { loadOcrSettings } from './config';
import { OcrSettings } from './Settings';
import { extractAllOnPage, extractWithToast } from './run';
import { updateBlock } from '../../store/notes';
import { toast } from '../../store/ui';
import type { ImageBlock } from '../../types';

void loadOcrSettings();

function blockActions(block: Block, pageId: string): BlockAction[] {
  if (block.type !== 'image' || block.heat) return [];
  const acts: BlockAction[] = [{ id: 'ocr-read', label: block.ocr ? 'Re-read text' : 'Extract text', run: () => extractWithToast(pageId, block.id) }];
  if (block.ocr) {
    acts.push({
      id: 'ocr-copy',
      label: 'Copy text',
      run: () => void navigator.clipboard?.writeText(block.ocr ?? '').then(() => toast('Copied the text'), () => toast('Couldn’t copy')),
    });
    acts.push({ id: 'ocr-clear', label: 'Clear text', run: () => updateBlock<ImageBlock>(pageId, block.id, (b) => void delete b.ocr) });
  }
  return acts;
}

const addon: AddOnModule = {
  Settings: OcrSettings,
  blockActions,
  commands: ({ pageId }) => (pageId ? [{ id: 'ocr-page', icon: 'image', title: 'Extract text from the pictures on this page', run: () => void extractAllOnPage(pageId) }] : []),
};

export default addon;
