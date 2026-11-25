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
    version: '0.3.1',
    date: '2026-11-25',
    title: 'Move whole card folders between workspaces',
    items: [
      'A card folder or section’s ⋯ menu can move or copy it to another workspace together with every section inside it and all their cards. A section that is moved becomes a folder at the top of the other workspace; copies get new ids and share the pictures.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-25',
    title: 'Scripts, and cards that move between workspaces',
    items: [
      'A new kind of page for writing scripts: screenplay, multi-camera TV, stage play, two-column video | audio, audio drama / podcast, and a story manuscript. Each lays the page out the way that form is written (margins, capitals, centred speakers, double spacing, brackets for sound cues).',
      'Write like a screenwriting program: Enter picks the next element (cue → dialogue → action), Tab or Ctrl+1…9 changes the element, a type-ahead offers character names, places, times of day and transitions, and typing INT. or CUT TO: makes the heading or transition by itself.',
      'A side panel with the scene list (move a scene up or down with everything in it), scenes as index cards with a summary, who speaks (with a rename-everywhere), ten ready-made story structures (three acts, Save the Cat, eight sequences, Hero’s Journey, story circle, five acts, TV hour) added as an outline with the page each beat usually falls on, and the title page.',
      'Pages, running time and word count follow the form (a page a minute for a screenplay, spoken words for audio, about 250 words a page for a manuscript); long speeches continue on the next page with (MORE) and (CONT’D).',
      'Scripts are stored as Fountain text, the plain format that Highland, Fade In, WriterDuet, Celtx and others read, so they open anywhere; an older version of the app shows one as a readable text box. Export as PDF with real text, Fountain, or text as printed.',
      'On a phone the script is a reading and writing layout of its own, with the element types as a strip of pictures above the keyboard and the side panel as a full screen.',
      'Cards can be copied or cut and pasted into another workspace (from a card’s ⋯ button, right-click, or its detail window), and moved or copied directly with a Workspace button. Paste appears as a bar (or Ctrl+V, or the command palette) in the workspace you open.',
    ],
  },
  {
    version: '0.2.3',
    date: '2026-11-22',
    title: 'Pictures before words',
    items: [
      'Every menu now shows a small picture beside each entry, so you can pick by the picture.',
      'On a phone, a selected box’s buttons are pictures (its kind, style, header, colour, layer, link, copy, delete…), the text bar’s list, clear, insert and done buttons are pictures, and Sync and Select in the library are pictures; the words stay in the tooltip and for screen readers.',
      'The page’s ⋯ panel is a grid of picture tiles. A selected frame has its own strip of finger-sized buttons at the bottom instead of tiny icons in its heading, and a tap on a frame’s title only selects it (double-tap edits).',
      'Settings → Data buttons carry pictures too.',
    ],
  },
  {
    version: '0.2.2',
    date: '2026-11-22',
    title: 'A tidier phone',
    items: [
      'Every screen of the phone layout was walked through and fixed: the folder tree on Cards starts rolled up, dropdowns and headers no longer clip, the journal, library and cards headers are compact, and cards come two to a row.',
      'Menus open as a sheet from the bottom, messages sit above the tab bar, Settings fills the screen, and the pick bar, the box buttons and the 3D and graph views fit the screen.',
      'Documents and presentations fit the phone, a presentation’s slide list opens on request, and a tap on Done in the text bar closes the keyboard and brings back the box’s own buttons.',
      'The new Today strip, the Today and Find dialogs and the template picker are laid out properly (the picker showed blank rows).',
    ],
  },
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
