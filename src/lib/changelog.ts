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
