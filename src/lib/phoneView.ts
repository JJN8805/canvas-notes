/** Rules for the phone layout (pure). A phone is a narrow window: the same breakpoint the stylesheet uses. */
export const PHONE_MAX_WIDTH = 760;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

/**
 * Where a page starts on a phone: wide enough that its words are readable, from the top left of what is on it. The zoom makes the content
 * (plus a little margin) fit the screen's width, but never smaller than `min` (text stays legible; the rest is a swipe away) and never
 * bigger than 1. Returns the zoom and the top-left corner (page coordinates) to scroll to.
 */
export function fitWidthStart(content: { minX: number; minY: number; maxX: number; maxY: number }, viewWidth: number, pad = 16, min = 0.5): { zoom: number; x: number; y: number } {
  const w = Math.max(1, content.maxX - content.minX + pad * 2);
  const zoom = Math.max(min, Math.min(1, viewWidth / w));
  return { zoom: Math.round(zoom * 100) / 100, x: content.minX - pad, y: content.minY - pad };
}

/** Which bottom tab a library screen belongs to (`more` for everything the tabs do not show). */
export type PhoneTab = 'pages' | 'journal' | 'cards' | 'more';
export function tabOf(kind: string): PhoneTab {
  if (['all', 'group', 'groups', 'ungrouped', 'tag', 'tags'].includes(kind)) return 'pages';
  if (kind === 'journal') return 'journal';
  if (kind === 'cards') return 'cards';
  return 'more';
}

/** Whether the "new page" button floats over this screen (the screens that list pages). */
export const showsNewPage = (kind: string): boolean => ['all', 'group', 'ungrouped', 'tag'].includes(kind);
