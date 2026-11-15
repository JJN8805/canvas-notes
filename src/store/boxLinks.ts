/** Making, removing and following the links on a box, frame or card. */
import type { BoxLink } from '../types';
import { addLink, linksOf, removeLink, replaceLink, resolveLink } from '../lib/boxLinks';
import { isCard } from '../lib/pages';
import { setSelected } from './canvas';
import { openCard } from './cardView';
import { updateBlock, useNotes } from './notes';
import { toast } from './ui';
import { create } from 'zustand';

function setLinks(pageId: string, blockId: string, fn: (l: BoxLink[]) => BoxLink[]) {
  updateBlock(pageId, blockId, (b) => {
    const next = fn(linksOf(b as never));
    if (next.length) b.links = next;
    else delete b.links;
  });
}

export const addBoxLink = (pageId: string, blockId: string, link: BoxLink) => setLinks(pageId, blockId, (l) => addLink(l, link));
export const replaceBoxLink = (pageId: string, blockId: string, old: BoxLink, next: BoxLink) => setLinks(pageId, blockId, (l) => replaceLink(l, old, next));
export const removeBoxLink = (pageId: string, blockId: string, link: BoxLink) => setLinks(pageId, blockId, (l) => removeLink(l, link));

/** Open what a link leads to: a card opens its detail, a page opens on the canvas, and a box is scrolled to and selected. */
export async function followLink(link: BoxLink) {
  const { navigate, currentRoute } = await import('../lib/route'); // loaded when needed: it reads the window address
  const pages = useNotes.getState().pages;
  const r = resolveLink(link, pages);
  if (!r.page) return void toast('That page or card no longer exists.');
  if (r.broken === 'block') toast('That box is gone; opened the page instead.');
  if (isCard(r.page)) return openCard(r.page.id);
  const sameRoute = currentRoute().name === 'page' && (currentRoute() as { id: string }).id === r.page.id;
  if (!sameRoute) navigate({ name: 'page', id: r.page.id });
  const blockId = r.block?.id;
  if (!blockId) return;
  // The page may still be opening: wait for the box to be on screen (about a second at most), then bring it into view.
  let tries = 0;
  const look = () => {
    const el = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(blockId)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      setSelected([blockId]);
    } else if (++tries < 40) window.setTimeout(look, 30);
  };
  look();
}

/** Which box's links the link dialog is editing (a page's or card's box), or null when it is closed. */
export const useLinkDialog = create<{ target: { pageId: string; blockId: string } | null }>(() => ({ target: null }));
export const openLinkDialog = (pageId: string, blockId: string) => useLinkDialog.setState({ target: { pageId, blockId } });
export const closeLinkDialog = () => useLinkDialog.setState({ target: null });
