/** Names of what can be added to a page: every box type, with the three styles of note named on their own ('text', 'sticky', 'code'). */
export type AddKind = Exclude<BlockType, 'note'> | 'text' | 'sticky' | 'code';
export type BlockType = 'note' | 'image' | 'checklist' | 'table' | 'frame' | 'audio' | 'pdf' | 'card';

/** The muted colours offered for boxes, stickies and page cards. Their light and dark values are
 *  the `--n-*` tokens in styles.css; each has a matching `--n-*-ink` for text on top of it. */
export const NOTE_COLORS = ['yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'green', 'gray'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

interface BlockBase {
  id: string;
  type: BlockType;
  /** Position and size in canvas pixels (zoom 100%). */
  x: number;
  y: number;
  w: number;
  /** Fixed height for images; minimum height for everything else. */
  h: number;
  z: number;
  /** Last measured rendered height, used for thumbnails and hit-testing. */
  ah?: number;
  /** Id of the frame directly containing this block, if any. Shared by every
   *  block type (including frames) so frames can nest inside frames. */
  frameId?: string | null;
  /** Painted above the page's drawing instead of under it. Absent = under (how every page from before this looked). A frame's contents follow the frame. */
  over?: boolean;
  /** Pinned in place: it cannot be dragged, resized, nudged, aligned or deleted until unlocked. Absent = free. Older app versions ignore it. */
  locked?: boolean;
  /** Links from this box to other pages, cards or boxes (a frame is a box too). Absent = none. Stored in the page JSON, so they sync and older app versions ignore them. */
  links?: BoxLink[];
  /** Background tint (a border for pictures). Absent or null = no colour. Frames use their own `color` instead. */
  tint?: NoteColor | null;
}

/** Where a link leads: a page or card, and optionally one box (or frame) on it. */
export interface BoxLink {
  page: string;
  block?: string;
}

/** Number formats a spreadsheet cell can show a value in. */
export type NumberFormat = 'num' | 'int' | 'cur' | 'pct' | 'date';

/** How one spreadsheet cell looks. Absent = "General", left for text and right for numbers. */
export interface CellFormat {
  b?: 1;
  i?: 1;
  /** Alignment. */
  al?: 'l' | 'c' | 'r';
  nf?: NumberFormat;
  /** Decimal places for num, cur and pct. */
  dec?: number;
  bg?: NoteColor;
}

/**
 * What turns a plain table into a spreadsheet: formulas in the cells (text starting with "=", worked out when shown), cell formats and
 * column widths. Older app versions ignore it and show the cells as a table, formulas as text. Optional, so nothing before it changes.
 */
export interface CalcMeta {
  /** This table is the whole page of a spreadsheet (a Workspace spreadsheet): the page opens as a spreadsheet, not a canvas. */
  page?: true;
  /** Formats by cell name ("B2"). */
  fmt?: Record<string, CellFormat>;
  /** Column widths in pixels by column number (0 = A). */
  colW?: Record<string, number>;
  /** How many of the first rows stay in view while scrolling. */
  freeze?: number;
}

/** Marks a text box as the whole page of a document (a Workspace document): the page opens as a document, not a canvas. */
export interface DocMeta {
  page: true;
  size?: 'letter' | 'a4';
}

/** Marks a frame as a slide of a presentation (a Workspace presentation). */
export interface SlideMeta {
  /** What the speaker will say. */
  notes?: string;
  /** The slide's background. Absent = white. */
  bg?: NoteColor | null;
}

/** How a note looks and what it holds: 'text' = a formatted text box, 'sticky' = a small coloured note, 'code' = plain monospace text. */
export type NoteStyle = 'text' | 'sticky' | 'code';
export const NOTE_STYLES: NoteStyle[] = ['text', 'sticky', 'code'];
/**
 * The one box for writing. `style` chooses the look: a text box (formatted text), a sticky (a small coloured note: its colour is the
 * block's `tint`, fixed size, long text scrolls) or code (plain monospace text, kept in `code`; `html` is then empty). The other
 * fields apply to the styles they make sense for (`fill` text, `doc` text). Pages written before this type existed have
 * 'text', 'sticky' and 'code' boxes: they are turned into notes when read (lib/note.ts `legacyNote`).
 */
export interface NoteBlock extends BlockBase {
  type: 'note';
  style: NoteStyle;
  html: string;
  /** The text of a code note. Absent for the other styles. */
  code?: string;
  fill?: boolean;
  /** Set on the text of a Workspace document. */
  doc?: DocMeta;
}
export interface ImageBlock extends BlockBase {
  type: 'image';
  imageId: string;
  aspect: number;
  alt?: string;
  /** Text read from the picture by the OCR add-on, so search can find it. Absent = none. Older app versions ignore it. */
  ocr?: string;
  /** Set on the heatmap pictures of an attendance page: a fingerprint of the drawing, so it is only redrawn when it changes. */
  heat?: string;
}
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
/**
 * Daily tracking for a checklist (see lib/attendance.ts). Absent = not tracked, and older app versions simply ignore it.
 * `log` maps a date (YYYY-MM-DD) to the ids of the items that were checked that day; a day with nothing checked has no entry.
 */
export interface ChecklistTrack {
  /** The first day tracked. */
  start: string;
  /** The day the list's current checks belong to; checks are cleared when a new day starts. */
  day: string;
  log: Record<string, string[]>;
  /** The first day each item was seen on the list, so an item added later isn't counted as missed for earlier days. */
  first: Record<string, string>;
}
export interface ChecklistBlock extends BlockBase {
  type: 'checklist';
  items: ChecklistItem[];
  track?: ChecklistTrack;
}
export interface TableBlock extends BlockBase {
  type: 'table';
  rows: string[][];
  /** Set on the summary table of an attendance page: the tracked checklist it is built from. Absent on ordinary tables. */
  attendance?: { pageId: string; blockId: string };
  /** Set when the table is a spreadsheet (see CalcMeta). */
  calc?: CalcMeta;
}
export interface FrameBlock extends BlockBase {
  type: 'frame';
  title: string;
  color: GroupColor | NoteColor;
  collapsed: boolean;
  /** Set when the frame is a slide of a presentation. */
  slide?: SlideMeta;
}
/** An audio clip (a file added or a recording). The bytes live in the file store under `fileId`, like pictures do. */
export interface AudioBlock extends BlockBase {
  type: 'audio';
  fileId: string;
  /** Shown above the player and searched. */
  name: string;
  /** Length in seconds, when it could be read. */
  duration?: number;
}
/** A PDF shown one page at a time (which page is being looked at isn't saved). The bytes live in the file store under `fileId`. */
export interface PdfBlock extends BlockBase {
  type: 'pdf';
  fileId: string;
  name: string;
  /** Number of pages, read when the file was added. */
  pages?: number;
}
/**
 * A card shown on the page. The card itself (its picture, label and details) is its own item in the Cards gallery, not part of
 * the page: this box only points at it by id, so deleting the box leaves the card, and one card can be shown on several pages.
 */
export interface CardBlock extends BlockBase {
  type: 'card';
  cardId: string;
}
export type Block = NoteBlock | ImageBlock | ChecklistBlock | TableBlock | FrameBlock | AudioBlock | PdfBlock | CardBlock;

export type ArrowheadMode = 'none' | 'one' | 'both';
export type LineStyle = 'solid' | 'dashed';

/** A connector between two blocks. Endpoints are not stored: the route is always the
 *  current shortest side-to-side path between the two blocks (see lib/arrows.ts), so
 *  moving or resizing either block keeps the arrow attached automatically. */
export interface Arrow {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** 'one' = head at `to` only. */
  heads: ArrowheadMode;
  style: LineStyle;
  z: number;
}

/** Freehand ink over the whole page, made with Excalidraw. `scene` is its JSON (the elements), and
 *  `preview` an SVG render of them that covers the box x/y/w/h in canvas pixels, so the canvas,
 *  thumbnails and exports never need to load Excalidraw. */
/** The edges of a finite page. */
export interface Sheet {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageDrawing {
  /** The whole drawing sits behind every box (instead of in front of the ones not marked `over`). Absent = in front. */
  behind?: boolean;
  scene: string;
  preview: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A page is a normal page, a template (kept for starting new pages from) or a card (a cover picture, a label and details, shown in the Cards gallery). */
export type PageKind = 'page' | 'template' | 'card';

export interface Page {
  id: string;
  title: string;
  groupId: string | null;
  tags: string[];
  blocks: Block[];
  arrows: Arrow[];
  /** Absent means 'page'. Templates and cards live in the same table and sync like pages but never show in the page library. */
  kind?: PageKind;
  /** For a daily page, its local calendar date as YYYY-MM-DD. At most one live page per date. */
  dailyDate?: string | null;
  /** Colour of the page's card in the library. Absent or null = none. */
  color?: NoteColor | null;
  /** Absent when nothing is drawn on the page. */
  drawing?: PageDrawing | null;
  /** The page's one rectangle (canvas coordinates) that every box stays inside. Absent or null = an infinite page (every page from before this existed). */
  sheet?: Sheet | null;
  /** The id of a stored picture shown as this page's cover in the library, instead of the automatic miniature. Absent or null = no cover. */
  cover?: string | null;
  created: number;
  updated: number;
  /** Revision stored on disk. 0 means never saved. Used to detect edits from another window. */
  rev: number;
}

export const GROUP_COLORS = ['teal', 'ochre', 'plum', 'moss', 'brick', 'ultra', 'slate'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export interface Group {
  id: string;
  name: string;
  color: GroupColor;
  /** The group this one is inside; null = top level. */
  parentId: string | null;
  /** 'cards' = a folder or section of the Cards screen. Absent = an ordinary page group. Card folders are kept apart from page groups. */
  scope?: 'cards';
  /** A few words about what this folder or section is for (card folders only). Absent = none. */
  description?: string;
}

export type Filter =
  | { kind: 'all' }
  | { kind: 'ungrouped' }
  | { kind: 'groups' }
  | { kind: 'group'; id: string }
  | { kind: 'tags' }
  | { kind: 'cards' }
  | { kind: 'tag'; tag: string }
  | { kind: 'trash' }
  | { kind: 'templates' }
  /** The Journal: the daily pages as a book. */
  | { kind: 'journal' }
  /** The full-page screen of an add-on (see `AddOnModule.View`), by the add-on's id. */
  | { kind: 'addon'; id: string };

export type SortKey = 'updated' | 'created' | 'title';
