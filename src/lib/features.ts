/**
 * What the app can switch off, and the ready-made sets ("profiles"). Pure: the list, the profiles and the rules; the stored choice and the
 * switches on screen are in `store/features.ts` and the Features tab of Settings.
 *
 * A switched-off feature disappears from the screens (sidebar, menus, toolbars, shortcuts, the command palette). Nothing is deleted:
 * pages, cards and links stay in the database and sync, so a feature can be switched back on and everything is there.
 */
export type FeatureId =
  | 'canvas' | 'journal' | 'cards' | 'groups' | 'tags' | 'templates' | 'archive' | 'links' | 'graph' | 'space' | 'media' | 'drawing' | 'widgets' | 'sync'
  | 'doc' | 'sheet' | 'slides';

export interface FeatureInfo {
  id: FeatureId;
  label: string;
  description: string;
  section: 'Workspace' | 'Pages' | 'Tools' | 'Devices';
  /** Needs another feature: with that one off, this one is off too. */
  needs?: FeatureId;
}

export const FEATURES: readonly FeatureInfo[] = [
  { id: 'doc', section: 'Workspace', label: 'Documents', description: 'Word-style documents.' },
  { id: 'sheet', section: 'Workspace', label: 'Spreadsheets', description: 'Excel-style spreadsheets with formulas.' },
  { id: 'slides', section: 'Workspace', label: 'Presentations', description: 'Slides with speaker notes and a full-screen show.' },
  { id: 'canvas', section: 'Pages', label: 'Free canvas pages', description: 'Creating pages where boxes can go anywhere. Existing pages still open.' },
  { id: 'journal', section: 'Pages', label: 'Journal', description: 'A page for each day, the weekly review and attendance.' },
  { id: 'cards', section: 'Pages', label: 'Cards', description: 'Cards with a picture and details, filed in folders.' },
  { id: 'groups', section: 'Pages', label: 'Groups', description: 'Putting pages in groups.' },
  { id: 'tags', section: 'Pages', label: 'Tags', description: 'Labelling pages with tags.' },
  { id: 'templates', section: 'Pages', label: 'Templates', description: 'Starting pages from templates and saving your own.' },
  { id: 'archive', section: 'Pages', label: 'Archive', description: 'Putting pages and cards away in the Archive, out of the library but kept.' },
  { id: 'links', section: 'Tools', label: 'Links', description: 'Links between boxes, pages and cards, and [[page]] links in text.' },
  { id: 'graph', section: 'Tools', label: 'Graph view', description: 'A map of how pages and cards link.', needs: 'links' },
  { id: 'space', section: 'Tools', label: '3D page view', description: 'Seeing a page’s boxes in 3D, placing them nearer or further away, and writing notes there.', needs: 'canvas' },
  { id: 'media', section: 'Tools', label: 'Pictures, audio and PDFs', description: 'Adding pictures, recordings and PDF files to a canvas page.' },
  { id: 'drawing', section: 'Tools', label: 'Drawing', description: 'The drawing layer on a page.' },
  { id: 'widgets', section: 'Devices', label: 'Desktop widgets', description: 'Pinning pages and boxes to the desktop.' },
  { id: 'sync', section: 'Devices', label: 'Sync with a phone', description: 'Syncing with your phone over the local network.' },
];

export const FEATURE_IDS: readonly FeatureId[] = FEATURES.map((f) => f.id);
export const isFeatureId = (v: unknown): v is FeatureId => typeof v === 'string' && FEATURE_IDS.includes(v as FeatureId);

export type ProfileId = 'everything' | 'office' | 'documents' | 'notes';

export interface Profile {
  id: ProfileId;
  label: string;
  description: string;
  /** Features that are off. */
  off: FeatureId[];
  /** Whether the Workspace add-on runs. */
  workspace: boolean;
}

const ALL_BUT_WORKSPACE: FeatureId[] = ['canvas', 'journal', 'cards', 'groups', 'tags', 'templates', 'archive', 'links', 'graph', 'space', 'media', 'drawing', 'widgets', 'sync'];

export const PROFILES: readonly Profile[] = [
  { id: 'everything', label: 'Everything', description: 'Every feature: canvas pages, cards, journal, links, documents, spreadsheets and presentations.', off: [], workspace: true },
  { id: 'office', label: 'Word, Excel and PowerPoint only', description: 'Documents, spreadsheets and presentations, and nothing else. Your pages are listed in All pages.', off: ALL_BUT_WORKSPACE, workspace: true },
  { id: 'documents', label: 'Word and Excel only', description: 'Documents and spreadsheets, and nothing else.', off: [...ALL_BUT_WORKSPACE, 'slides'], workspace: true },
  { id: 'notes', label: 'Notes without Workspace', description: 'The free canvas, cards, journal and links, without documents, spreadsheets and presentations.', off: ['doc', 'sheet', 'slides'], workspace: false },
];

export const profileById = (id: unknown): Profile | undefined => PROFILES.find((p) => p.id === id);

/** The saved list of switched-off features, or `fallback` when nothing valid was saved (a feature this version doesn't know is dropped). */
export function parseDisabled(raw: string | null, fallback: readonly FeatureId[] = []): FeatureId[] {
  if (raw === null) return [...fallback];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? [...new Set(v.filter(isFeatureId))] : [...fallback];
  } catch {
    return [...fallback];
  }
}

/** Everything that is really off: what was switched off, and what needs one of those. */
export function effectiveOff(disabled: readonly FeatureId[]): Set<FeatureId> {
  const off = new Set(disabled);
  for (const f of FEATURES) if (f.needs && off.has(f.needs)) off.add(f.id);
  return off;
}

export const isFeatureOn = (disabled: readonly FeatureId[], id: FeatureId): boolean => !effectiveOff(disabled).has(id);

/** Which ready-made set the switches match exactly, or 'custom'. */
export function profileOf(disabled: readonly FeatureId[], workspace: boolean): ProfileId | 'custom' {
  const want = [...effectiveOff(disabled)].sort().join(',');
  return PROFILES.find((p) => p.workspace === workspace && [...effectiveOff(p.off)].sort().join(',') === want)?.id ?? 'custom';
}

/** The ready-made set a build ships with (set when it is made: `FEATURE_PROFILE=office npm run dev`), or 'everything'. */
export function buildProfile(raw: unknown = typeof __FEATURE_PROFILE__ === 'string' ? __FEATURE_PROFILE__ : ''): Profile {
  return profileById(raw) ?? PROFILES[0];
}

/** Whether any part of Workspace is on: the Workspace screen and its commands need at least one of the three. */
export const workspaceOn = (disabled: readonly FeatureId[]): boolean => (['doc', 'sheet', 'slides'] as const).some((f) => isFeatureOn(disabled, f));
