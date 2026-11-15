import { navigate } from '../../lib/route';
import { setSelected } from '../../store/canvas';

/** Opens a page and brings one of its boxes into view and selects it (waits for the page to appear; gives up quietly if the box is gone). */
export function openBox(pageId: string, blockId: string) {
  navigate({ name: 'page', id: pageId });
  let tries = 0;
  const look = () => {
    const el = document.querySelector<HTMLElement>(`.world [data-id="${CSS.escape(blockId)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      setSelected([blockId]);
    } else if (++tries < 40) window.setTimeout(look, 100);
  };
  window.setTimeout(look, 100);
}
