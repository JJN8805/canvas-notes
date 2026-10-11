export type BlockType = 'text' | 'image' | 'checklist' | 'code' | 'table' | 'frame';

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
  color: GroupColor;
  collapsed: boolean;
}
export type Block = TextBlock | ImageBlock | ChecklistBlock | CodeBlock | TableBlock | FrameBlock;

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

export interface Page {
  id: string;
  title: string;
  groupId: string | null;
  tags: string[];
  blocks: Block[];
  arrows: Arrow[];
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
  | { kind: 'trash' };

export type SortKey = 'updated' | 'created' | 'title';
