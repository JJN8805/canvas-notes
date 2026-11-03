import { Arrow } from '../../types';
import { newId } from '../../lib/util';
import type { Draft } from 'immer';
import { get } from './state';
import { HistoryMode, mutatePage } from './mutate';

/* ------------------------------------------------------------------ */
/* Arrows                                                              */
/* ------------------------------------------------------------------ */

export const maxArrowZ = (arrows: Arrow[]) => arrows.reduce((m, a) => Math.max(m, a.z || 0), 0);

export function addArrow(pageId: string, from: string, to: string): string {
  const page = get().pages[pageId];
  if (!page || from === to) return '';
  const id = newId();
  const arrow: Arrow = { id, from, to, heads: 'one', style: 'solid', z: maxArrowZ(page.arrows) + 1 };
  mutatePage(pageId, (p) => {
    p.arrows.push(arrow as Draft<Arrow>);
  });
  return id;
}

export function updateArrow(pageId: string, arrowId: string, recipe: (a: Draft<Arrow>) => void, opts?: { history?: HistoryMode; touch?: boolean }) {
  mutatePage(
    pageId,
    (p) => {
      const a = p.arrows.find((x) => x.id === arrowId);
      if (a) recipe(a);
    },
    opts,
  );
}

export function deleteArrows(pageId: string, ids: string[]) {
  const drop = new Set(ids);
  mutatePage(pageId, (p) => {
    p.arrows = p.arrows.filter((a) => !drop.has(a.id));
  });
}

