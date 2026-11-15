import { removePageCover, setPageCover } from '../../store/pageCover';
import { toast } from '../../store/ui';

/** Opens the file picker, then makes the chosen picture the page's cover. Nothing happens if the picker is cancelled. */
export function chooseCover(pageId: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    setPageCover(pageId, file).then(
      () => toast('Cover set. Its card in the library now shows this picture.', { label: 'Undo', run: () => removePageCover(pageId) }, 6000),
      (e) => toast(`The cover couldn’t be set: ${e instanceof Error ? e.message : e}`),
    );
  };
  input.click();
}
