/** Which side panels are open (pure). Remembered on this device; anything unreadable means "open", the way the app always looked. */
export interface Layout {
  /** The library's sidebar (pages, groups, cards…). */
  sidebar: boolean;
  /** The Cards screen's folder tree. */
  cardTree: boolean;
}

export const DEFAULT_LAYOUT: Layout = { sidebar: true, cardTree: true };

export function parseLayout(raw: string | null | undefined): Layout {
  try {
    const v: unknown = JSON.parse(raw ?? '{}');
    const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    return { sidebar: o.sidebar !== false, cardTree: o.cardTree !== false };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}
