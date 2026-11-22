/** What changed in each release, newest first. The top entry must match package.json (tests/appInfo.test.ts checks). */
export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '0.2.1',
    date: '2026-11-22',
    title: 'Pictures for card folders and sections',
    items: [
      'A card folder or section can have its own picture: shown small in its heading and as a banner at the top of it. Add, change or remove it from its menu or its edit form. It syncs to your phone and is kept in backups and archive files.',
      'Export a workspace as a small website, or as Markdown files with their pictures.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-22',
    title: 'Workspaces, the phone, and much more',
    items: [
      'Workspaces: separate desks inside one app (for example Student and Content creator), each with its own pages, groups, cards, journal and archive, in one library. Move, copy, link and search across them; switch with Ctrl+Alt+1–9; drop a page card on a workspace; quick notes into an Inbox (Ctrl+Alt+N); Today across all of them; archive or export one workspace.',
      'A phone layout of its own, with a bottom tab bar, a docked toolbar above the keyboard, and a touch way for every keyboard shortcut. `npm run phone` installs the current build on your phone and keeps its notes.',
      'The 3D page view: orbit, zoom to the pointer, named views, a depth grip, and the last view remembered per page.',
      'A / menu to insert boxes, turn a note into a list, page icons and cover pictures, favorites and recent pages, focus mode.',
      'Collapsible headers on text and sticky notes; GIFs and videos on pages and cards; box links between pages; frames you can colour.',
      'Archive pages you want out of the way; pick several pages at once; one dated .zip archive of everything (or of one workspace), with an optional automatic one.',
      'Pairing your phone with one link or QR code instead of typing an address and code.',
      'Fewer pauses: switching windows and syncing now read only what changed, and background tidying waits until the app has been open a while.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-11-09',
    title: 'The first release',
    items: [
      'A free canvas for notes (text, sticky and code in one box), pictures, checklists, code, tables, audio, PDFs, cards and frames, with arrows and a drawing layer.',
      'Finite pages with edges, plus the original endless canvas.',
      'Syncs between your computer and phone over your own network, encrypted, with no server or account.',
      'The Journal: a page for every day, a weekly review and attendance tracking.',
      'Right-click menus, align and spread, lock in place, Ctrl+drag to copy, Tab to branch, a map for big pages and a hand tool.',
      'One-letter keys you can change, and a shortcut sheet on the ? key.',
      'Tidy this page, layers above or below the drawing, undo that covers every change.',
      'Encrypted backups, PDF, PNG and Markdown export, colour themes.',
      'Optional AI assistant and picture-reading add-ons that only send what you choose, after you see it.',
    ],
  },
];

export const latestRelease = (): Release => CHANGELOG[0];
