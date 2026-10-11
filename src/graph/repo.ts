import type { GraphDb } from './db';
import { edgeId } from './uuid';

/* ------------------------------------------------------------------ */
/* Row shapes (as stored)                                              */
/* ------------------------------------------------------------------ */

export type NodeType = 'page' | 'tag' | 'group';
export type EdgeType = 'LINKS_TO' | 'TAGGED' | 'IN_GROUP' | 'PARENT_OF' | 'RELATED';

interface Stamped {
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  device_id: string;
}
export interface NodeRow extends Stamped {
  id: string;
  type: NodeType;
  title: string;
  color: string | null;
  thumbnail_asset_id: string | null;
  viewport: string;
  pinned: number;
  archived: number;
  props: string;
}
export interface EdgeRow extends Stamped {
  id: string;
  src: string;
  dst: string;
  type: EdgeType;
  props: string;
}
export interface BlockRow extends Stamped {
  id: string;
  page_id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rotation: number;
  asset_id: string | null;
  content: string;
  plain_text: string;
}
export interface ConnectorRow extends Stamped {
  id: string;
  page_id: string;
  from_block_id: string;
  to_block_id: string;
  label: string | null;
  style: string;
}
export interface AssetRow extends Stamped {
  id: string;
  sha256: string;
  rel_path: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
}
export interface SearchHit {
  blockId: string;
  pageId: string;
  snippet: string;
}

/* ------------------------------------------------------------------ */
/* Column handling                                                     */
/* ------------------------------------------------------------------ */

// The writable columns of each table. Input keys are camelCase (pageId → page_id) and are
// checked against these lists, so a key can never smuggle SQL into a statement.
const COLUMNS = {
  nodes: ['type', 'title', 'color', 'thumbnail_asset_id', 'viewport', 'pinned', 'archived', 'props'],
  blocks: ['page_id', 'type', 'x', 'y', 'w', 'h', 'z', 'rotation', 'asset_id', 'content', 'plain_text'],
  connectors: ['page_id', 'from_block_id', 'to_block_id', 'label', 'style'],
  assets: ['sha256', 'rel_path', 'mime', 'size_bytes', 'width', 'height'],
} as const;
type Table = keyof typeof COLUMNS;

const JSON_COLUMNS = new Set(['viewport', 'props', 'content', 'style']);
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

/** camelCase input → { column: value } (objects in JSON columns are stringified). */
function toColumns(table: Table, input: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    const col = snake(k);
    if (!(COLUMNS[table] as readonly string[]).includes(col)) throw new Error(`${table}: unknown field "${k}"`);
    out[col] = JSON_COLUMNS.has(col) && typeof v !== 'string' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return out;
}

const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

export type NodeInput = { id?: string; createdAt?: number } & Partial<{
  type: NodeType;
  title: string;
  color: string | null;
  thumbnailAssetId: string | null;
  viewport: object | string;
  pinned: boolean | number;
  archived: boolean | number;
  props: object | string;
}>;
export type BlockInput = { id?: string; createdAt?: number } & Partial<{
  pageId: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rotation: number;
  assetId: string | null;
  content: object | string;
  plainText: string;
}>;
export type ConnectorInput = { id?: string; createdAt?: number } & Partial<{
  pageId: string;
  fromBlockId: string;
  toBlockId: string;
  label: string | null;
  style: object | string;
}>;
export type AssetInput = { id?: string; createdAt?: number } & Partial<{
  sha256: string;
  relPath: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}>;

const uid = () => crypto.randomUUID();

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every read and write of the graph tables goes through here (all SQL lives in this file).
 * Each write stamps updated_at + device_id. Deletes set deleted_at and never remove rows,
 * so they can sync as tombstones.
 */
export class GraphRepo {
  constructor(
    private db: GraphDb,
    readonly deviceId: string,
    private now: () => number = Date.now,
  ) {}

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  /* ---- generic row helpers ---- */

  private async getRow<T>(table: string, id: string, includeDeleted = false): Promise<T | null> {
    const rows = await this.db.select<T & { deleted_at: number | null }>(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    const r = (rows as unknown as (T & { deleted_at: number | null })[])[0];
    return r && (includeDeleted || r.deleted_at === null) ? r : null;
  }

  private async insertRow<T>(table: Table, id: string, createdAt: number | undefined, input: object, required: string[]): Promise<T> {
    const cols = toColumns(table, input);
    for (const r of required) if (cols[r] === undefined) throw new Error(`${table}: "${r}" is required`);
    const t = this.now();
    const all = { id, ...cols, created_at: createdAt ?? t, updated_at: t, deleted_at: null, device_id: this.deviceId };
    const names = Object.keys(all);
    await this.db.execute(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(all),
    );
    return (await this.getRow<T>(table, id, true))!;
  }

  /** Updates only the fields that really change (so no-op saves don't bump updated_at). Revives a deleted row. */
  private async updateRow<T extends Stamped & { id: string }>(table: Table, row: T, input: object): Promise<T> {
    const cols = toColumns(table, input);
    const changed = Object.entries(cols).filter(([c, v]) => !sameValue((row as unknown as Record<string, unknown>)[c], v));
    if (!changed.length && row.deleted_at === null) return row;
    const sets = [...changed.map(([c]) => c), 'updated_at', 'deleted_at', 'device_id'];
    const vals = [...changed.map(([, v]) => v), this.now(), null, this.deviceId];
    await this.db.execute(`UPDATE ${table} SET ${sets.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${sets.length + 1}`, [...vals, row.id]);
    return (await this.getRow<T>(table, row.id, true))!;
  }

  private async softDelete(table: string, where: string, params: unknown[]): Promise<number> {
    const n = params.length;
    const r = await this.db.execute(
      `UPDATE ${table} SET deleted_at = $${n + 1}, updated_at = $${n + 1}, device_id = $${n + 2} WHERE deleted_at IS NULL AND ${where}`,
      [...params, this.now(), this.deviceId],
    );
    return r.rowsAffected;
  }

  /* ---- nodes (pages, tags, groups) ---- */

  getNode(id: string, includeDeleted = false) {
    return this.getRow<NodeRow>('nodes', id, includeDeleted);
  }

  listNodes(type: NodeType) {
    return this.db.select<NodeRow>('SELECT * FROM nodes WHERE type = $1 AND deleted_at IS NULL ORDER BY created_at, id', [type]);
  }

  /** Live tag/group lookup by title, ignoring case (matches the unique index on tags). */
  async findNodeByTitle(type: NodeType, title: string) {
    const rows = await this.db.select<NodeRow>('SELECT * FROM nodes WHERE type = $1 AND lower(title) = lower($2) AND deleted_at IS NULL LIMIT 1', [type, title]);
    return rows[0] ?? null;
  }

  createNode(input: NodeInput & { type: NodeType }): Promise<NodeRow> {
    const { id, createdAt, ...rest } = input;
    return this.insertRow<NodeRow>('nodes', id ?? uid(), createdAt, rest, ['type']);
  }

  async updateNode(id: string, patch: Omit<NodeInput, 'id' | 'createdAt'>): Promise<NodeRow> {
    const row = await this.getNode(id);
    if (!row) throw new Error(`node ${id} not found`);
    return this.updateRow('nodes', row, patch);
  }

  /** Create the node or bring an existing one (even a deleted one) up to date. */
  async putNode(input: NodeInput & { id: string; type: NodeType }): Promise<NodeRow> {
    const { id, createdAt, ...rest } = input;
    const row = await this.getNode(id, true);
    return row ? this.updateRow('nodes', row, rest) : this.insertRow<NodeRow>('nodes', id, createdAt, rest, ['type']);
  }

  /** Soft-deletes the node and everything hanging off it: its edges, and for a page its blocks and connectors. */
  deleteNode(id: string): Promise<void> {
    return this.db.transaction(async () => {
      await this.softDelete('nodes', 'id = $1', [id]);
      await this.softDelete('edges', '(src = $1 OR dst = $1)', [id]);
      await this.softDelete('connectors', 'page_id = $1', [id]);
      await this.softDelete('blocks', 'page_id = $1', [id]);
    });
  }

  /* ---- edges ---- */

  /**
   * Creates the relationship src --type--> dst. Its id is derived from the triple, so the
   * same relationship is always the same row (also across devices). Linking again is a
   * no-op, and linking after an unlink revives the old row rather than adding a second one.
   */
  async link(src: string, dst: string, type: EdgeType, props: object = {}): Promise<EdgeRow> {
    const id = await edgeId(src, dst, type);
    const json = JSON.stringify(props);
    const row = await this.getRow<EdgeRow>('edges', id, true);
    if (!row) {
      const t = this.now();
      await this.db.execute(
        'INSERT INTO edges (id, src, dst, type, props, created_at, updated_at, deleted_at, device_id) VALUES ($1, $2, $3, $4, $5, $6, $6, NULL, $7)',
        [id, src, dst, type, json, t, this.deviceId],
      );
    } else if (row.deleted_at !== null || row.props !== json) {
      await this.db.execute('UPDATE edges SET props = $2, deleted_at = NULL, updated_at = $3, device_id = $4 WHERE id = $1', [id, json, this.now(), this.deviceId]);
    }
    return (await this.getRow<EdgeRow>('edges', id, true))!;
  }

  /** Soft-deletes the relationship. Returns false if there was no live one. */
  async unlink(src: string, dst: string, type: EdgeType): Promise<boolean> {
    return (await this.softDelete('edges', 'src = $1 AND dst = $2 AND type = $3', [src, dst, type])) > 0;
  }

  async getEdge(src: string, dst: string, type: EdgeType, includeDeleted = false) {
    return this.getRow<EdgeRow>('edges', await edgeId(src, dst, type), includeDeleted);
  }

  /** Live edges, filtered by any of src / dst / type. */
  listEdges(filter: { src?: string; dst?: string; type?: EdgeType } = {}) {
    const where = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    for (const [col, v] of Object.entries(filter)) {
      if (v === undefined) continue;
      if (col !== 'src' && col !== 'dst' && col !== 'type') throw new Error(`edges: cannot filter on "${col}"`);
      params.push(v);
      where.push(`${col} = $${params.length}`);
    }
    return this.db.select<EdgeRow>(`SELECT * FROM edges WHERE ${where.join(' AND ')} ORDER BY created_at, id`, params);
  }

  /* ---- blocks ---- */

  getBlock(id: string, includeDeleted = false) {
    return this.getRow<BlockRow>('blocks', id, includeDeleted);
  }
  listBlocks(pageId: string, includeDeleted = false) {
    return this.db.select<BlockRow>(`SELECT * FROM blocks WHERE page_id = $1 ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY z, id`, [pageId]);
  }
  createBlock(input: BlockInput & { pageId: string; type: string }): Promise<BlockRow> {
    const { id, createdAt, ...rest } = input;
    return this.insertRow<BlockRow>('blocks', id ?? uid(), createdAt, rest, ['page_id', 'type']);
  }
  async updateBlock(id: string, patch: Omit<BlockInput, 'id' | 'createdAt'>): Promise<BlockRow> {
    const row = await this.getBlock(id);
    if (!row) throw new Error(`block ${id} not found`);
    return this.updateRow('blocks', row, patch);
  }
  async putBlock(input: BlockInput & { id: string; pageId: string; type: string }): Promise<BlockRow> {
    const { id, createdAt, ...rest } = input;
    const row = await this.getBlock(id, true);
    return row ? this.updateRow('blocks', row, rest) : this.insertRow<BlockRow>('blocks', id, createdAt, rest, ['page_id', 'type']);
  }
  async deleteBlock(id: string): Promise<void> {
    await this.softDelete('blocks', 'id = $1', [id]);
  }

  /* ---- connectors ---- */

  getConnector(id: string, includeDeleted = false) {
    return this.getRow<ConnectorRow>('connectors', id, includeDeleted);
  }
  listConnectors(pageId: string, includeDeleted = false) {
    return this.db.select<ConnectorRow>(`SELECT * FROM connectors WHERE page_id = $1 ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY created_at, id`, [pageId]);
  }
  createConnector(input: ConnectorInput & { pageId: string; fromBlockId: string; toBlockId: string }): Promise<ConnectorRow> {
    const { id, createdAt, ...rest } = input;
    return this.insertRow<ConnectorRow>('connectors', id ?? uid(), createdAt, rest, ['page_id', 'from_block_id', 'to_block_id']);
  }
  async updateConnector(id: string, patch: Omit<ConnectorInput, 'id' | 'createdAt'>): Promise<ConnectorRow> {
    const row = await this.getConnector(id);
    if (!row) throw new Error(`connector ${id} not found`);
    return this.updateRow('connectors', row, patch);
  }
  async putConnector(input: ConnectorInput & { id: string; pageId: string; fromBlockId: string; toBlockId: string }): Promise<ConnectorRow> {
    const { id, createdAt, ...rest } = input;
    const row = await this.getConnector(id, true);
    return row ? this.updateRow('connectors', row, rest) : this.insertRow<ConnectorRow>('connectors', id, createdAt, rest, ['page_id', 'from_block_id', 'to_block_id']);
  }
  async deleteConnector(id: string): Promise<void> {
    await this.softDelete('connectors', 'id = $1', [id]);
  }

  /* ---- assets ---- */

  getAsset(id: string, includeDeleted = false) {
    return this.getRow<AssetRow>('assets', id, includeDeleted);
  }
  createAsset(input: AssetInput & { sha256: string; relPath: string; mime: string; sizeBytes: number }): Promise<AssetRow> {
    const { id, createdAt, ...rest } = input;
    return this.insertRow<AssetRow>('assets', id ?? uid(), createdAt, rest, ['sha256', 'rel_path', 'mime', 'size_bytes']);
  }
  async updateAsset(id: string, patch: Omit<AssetInput, 'id' | 'createdAt'>): Promise<AssetRow> {
    const row = await this.getAsset(id);
    if (!row) throw new Error(`asset ${id} not found`);
    return this.updateRow('assets', row, patch);
  }
  async deleteAsset(id: string): Promise<void> {
    await this.softDelete('assets', 'id = $1', [id]);
  }

  /** The live page with this title (ignoring case); the oldest one if several share it. */
  async findPageByTitle(title: string) {
    const rows = await this.db.select<NodeRow>(
      `SELECT * FROM nodes WHERE type = 'page' AND lower(title) = lower($1) AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`,
      [title],
    );
    return rows[0] ?? null;
  }

  /** Ids of live pages having a block whose text contains [[title]] (case-insensitive). */
  async pageIdsLinkingTo(title: string): Promise<string[]> {
    const esc = title.replace(/[\\%_]/g, (c) => '\\' + c);
    const rows = await this.db.select<{ page_id: string }>(
      `SELECT DISTINCT page_id FROM blocks WHERE deleted_at IS NULL AND lower(plain_text) LIKE lower($1) ESCAPE '\\'`,
      [`%[[${esc}]]%`],
    );
    return rows.map((r) => r.page_id);
  }

  /** Live pages that link to `pageId`, with the block holding the first mention. */
  async backlinks(pageId: string): Promise<{ pageId: string; title: string; blockId: string | null }[]> {
    const rows = await this.db.select<{ id: string; title: string; props: string }>(
      `SELECT s.id, s.title, e.props FROM edges e JOIN nodes s ON s.id = e.src AND s.deleted_at IS NULL
       WHERE e.dst = $1 AND e.type = 'LINKS_TO' AND e.deleted_at IS NULL ORDER BY s.title COLLATE NOCASE, s.id`,
      [pageId],
    );
    return rows.map((r) => ({ pageId: r.id, title: r.title, blockId: (JSON.parse(r.props) as { block_id?: string }).block_id ?? null }));
  }

  /* ---- search ---- */

  /** Full-text search over live blocks. Each word is matched as a prefix; punctuation is ignored. */
  async searchBlocks(query: string, limit = 20): Promise<SearchHit[]> {
    const terms = query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (!terms.length) return [];
    const match = terms.map((t) => `"${t}"*`).join(' ');
    const rows = await this.db.select<{ block_id: string; page_id: string; snippet: string }>(
      `SELECT block_id, page_id, snippet(search_blocks, 2, '[', ']', '...', 12) AS snippet
       FROM search_blocks WHERE search_blocks MATCH $1 ORDER BY rank LIMIT $2`,
      [match, limit],
    );
    return rows.map((r) => ({ blockId: r.block_id, pageId: r.page_id, snippet: r.snippet }));
  }

  /* ---- device ---- */

  async ensureDevice(id: string, name: string): Promise<void> {
    await this.db.execute('INSERT OR IGNORE INTO devices (id, name, created_at) VALUES ($1, $2, $3)', [id, name, this.now()]);
  }
}
