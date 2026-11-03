import { useEffect, useRef } from 'react';
import { deleteBlocks, useNotes } from '../../../store/notes';
import { freshText } from '../../../store/canvas';

/** Text boxes made by double-click or the Text tool are removed again if they are still empty when deselected. */
export function useEmptyBoxCleanup(pageId: string, selected: string[]) {
  // A text box made by double-click or the Text tool that is left empty when the user moves on is removed, not left as an invisible box.
  const prevSelected = useRef<string[]>([]);
  useEffect(() => {
    const gone = prevSelected.current.filter((id) => !selected.includes(id));
    prevSelected.current = selected;
    for (const id of gone) {
      if (!freshText.delete(id)) continue;
      const b = useNotes.getState().pages[pageId]?.blocks.find((x) => x.id === id);
      if (b?.type === 'text' && !b.fill && !/<img/i.test(b.html) && !b.html.replace(/<[^>]*>|&nbsp;/g, '').trim()) deleteBlocks(pageId, [id]);
    }
  }, [selected, pageId]);
}
