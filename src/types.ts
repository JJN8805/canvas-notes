export type BlockType = 'text' | 'image' | 'checklist' | 'code' | 'table' | 'frame' | 'sticky';

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
  /** Background tint (a border for pictures). Absent or null = no colour. Frames use their own `color` instead. */
  tint?: NoteColor | null;
}

export interface TextBlock extends BlockBase {
  type: 'text';
  html: string;
  fill?: boolean;
}
export interface ImageBlock extends BlockBase {
  type: 'image';
  imageId: string;
  aspect: number;
  alt?: string;
}
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
export interface ChecklistBlock extends BlockBase {
  type: 'checklist';
  items: ChecklistItem[];
}
export interface CodeBlock extends BlockBase {
  type: 'code';
  code: string;
}
export interface TableBlock extends BlockBase {
  type: 'table';
  rows: string[][];
}
export interface FrameBlock extends BlockBase {
  type: 'frame';
  title: string;
  color: GroupColor | NoteColor;
  collapsed: boolean;
}
/** A small coloured note. Its colour is the block's `tint` (no tint = plain paper). Fixed size; long text scrolls. */
export interface StickyBlock extends BlockBase {
  type: 'sticky';
  html: string;
}
export type Block = TextBlock | ImageBlock | ChecklistBlock | CodeBlock | TableBlock | FrameBlock | StickyBlock;

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
export interface PageDrawing {
  scene: string;
  preview: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A page is either a normal page or a template (a page kept for starting new pages from). */
export type PageKind = 'page' | 'template';

export interface Page {
  id: string;
  title: string;
  groupId: string | null;
  tags: string[];
  blocks: Block[];
  arrows: Arrow[];
  /** Absent means 'page'. Templates live in the same table and sync like pages but never show in the library. */
  kind?: PageKind;
  /** For a daily page, its local calendar date as YYYY-MM-DD. At most one live page per date. */
  dailyDate?: string | null;
  /** Colour of the page's card in the library. Absent or null = none. */
  color?: NoteColor | null;
  /** Absent when nothing is drawn on the page. */
  drawing?: PageDrawing | null;
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
}

export type Filter =
  | { kind: 'all' }
  | { kind: 'ungrouped' }
  | { kind: 'group'; id: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'trash' }
  | { kind: 'templates' };

export type SortKey = 'updated' | 'created' | 'title';
