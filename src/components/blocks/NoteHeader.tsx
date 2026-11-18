import type { NoteBlock } from '../../types';
import { updateBlock } from '../../store/notes';
import { editorRegistry } from '../../store/canvas';
import { useCanvasCtx } from '../editor/context';

/**
 * The optional header of a text box: a fold arrow and a one-line title above the text. Folding shrinks the box to just this row
 * (`blockHeight` knows), so long notes can be tucked away on the page. Everything goes through `updateBlock`, so undo and sync work.
 */
export function NoteHeader({ block }: { block: NoteBlock }) {
  const { pageId } = useCanvasCtx();
  const folded = block.folded === true;
  const fold = (on: boolean) =>
    updateBlock<NoteBlock>(pageId, block.id, (b) => {
      if (on) b.folded = true;
      else delete b.folded;
    });
  return (
    <div className="note-head">
      <button
        className="note-fold"
        aria-expanded={!folded}
        aria-label={folded ? 'Unfold this box' : 'Fold this box to its header'}
        title={folded ? 'Unfold' : 'Fold to the header'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => fold(!folded)}
      >
        <span aria-hidden="true">▾</span>
      </button>
      <input
        className="note-title"
        value={block.header ?? ''}
        placeholder="Header"
        aria-label="Header"
        maxLength={200}
        onChange={(e) =>
          updateBlock<NoteBlock>(pageId, block.id, (b) => {
            b.header = e.target.value.replace(/\s+/g, ' ');
          }, { history: { key: 'note-header:' + block.id } })
        }
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (folded) fold(false);
          editorRegistry.get(block.id)?.commands.focus('end'); // on to the text
        }}
      />
    </div>
  );
}
