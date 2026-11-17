import { mutatePage } from './notes';
import { ask } from './ui';
import { cleanIcon } from '../lib/pageIcon';

/** Ask for a page's icon (one emoji or short mark; empty removes it) and set it. */
export async function choosePageIcon(pageId: string, current: string | null | undefined): Promise<void> {
  const v = await ask({
    title: 'Page icon',
    initial: current ?? '',
    okLabel: 'Set icon',
    placeholder: 'Paste or type an emoji, like 📘',
    text: 'Shown beside the page’s name in the library, the sidebar and the switcher. Leave it empty to remove it.',
  });
  if (v === null) return;
  const next = cleanIcon(v);
  mutatePage(pageId, (p) => {
    p.icon = next;
  }, { history: 'none' });
}
