import type { Block, FrameBlock } from '../../types';
import { TextBody } from './TextBody';
import { AudioBody } from './AudioBody';
import { PdfBody } from './PdfBody';
import { CardBody } from './CardBody';
import { ChecklistBody, CodeBody, ImageBody, TableBody } from './Bodies';

/** Every block type except frames, which render through FrameChrome instead. */
export type NonFrameBlock = Exclude<Block, FrameBlock>;

/** The content of a box, whether it sits on the canvas or in a desktop widget. */
export function BlockBody({ block }: { block: NonFrameBlock }) {
  switch (block.type) {
    case 'note':
      // The editor is made for one style; changing the style makes a fresh one.
      return block.style === 'code' ? <CodeBody block={block} /> : <TextBody key={block.style} block={block} />;
    case 'checklist':
      return <ChecklistBody block={block} />;
    case 'table':
      return <TableBody block={block} />;
    case 'image':
      return <ImageBody block={block} />;
    case 'audio':
      return <AudioBody block={block} />;
    case 'pdf':
      return <PdfBody block={block} />;
    case 'card':
      return <CardBody block={block} />;
  }
}
