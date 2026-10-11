// Migration 5 for the desktop database: the graph layer (see schema.sql in the project root).
// Generated from schema.sql, then adjusted:
//  - PRAGMAs removed (user_version is owned by MIGRATIONS; foreign_keys is per-connection)
//  - blocks.type also allows this app's block types (checklist, code, table, frame)
//  - no unique index on group titles: nested groups may repeat a name
// One statement per entry because the SQL plugin runs a single statement per call.
export const GRAPH_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS sync_peers (
  peer_device_id  TEXT PRIMARY KEY,
  last_pulled_at  INTEGER NOT NULL DEFAULT 0,
  last_pushed_at  INTEGER NOT NULL DEFAULT 0,
  last_sync_at    INTEGER
)`,
  `CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  sha256      TEXT NOT NULL,
  rel_path    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  device_id   TEXT NOT NULL
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_sha ON assets(sha256) WHERE deleted_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS nodes (
  id                  TEXT PRIMARY KEY,
  type                TEXT NOT NULL CHECK (type IN ('page', 'tag', 'group')),
  title               TEXT NOT NULL DEFAULT '',
  color               TEXT,
  thumbnail_asset_id  TEXT REFERENCES assets(id),
  viewport            TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  pinned              INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  archived            INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  props               TEXT NOT NULL DEFAULT '{}',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  device_id           TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_type    ON nodes(type, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_nodes_tag_title   ON nodes(lower(title)) WHERE type = 'tag'   AND deleted_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS edges (
  id          TEXT PRIMARY KEY,
  src         TEXT NOT NULL REFERENCES nodes(id),
  dst         TEXT NOT NULL REFERENCES nodes(id),
  type        TEXT NOT NULL CHECK (type IN ('LINKS_TO', 'TAGGED', 'IN_GROUP', 'PARENT_OF', 'RELATED')),
  props       TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  device_id   TEXT NOT NULL,
  CHECK (src <> dst)
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_edges_live  ON edges(src, dst, type) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_edges_src     ON edges(src, type) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_edges_dst     ON edges(dst, type) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_edges_updated ON edges(updated_at)`,
  `CREATE TABLE IF NOT EXISTS blocks (
  id          TEXT PRIMARY KEY,
  page_id     TEXT NOT NULL REFERENCES nodes(id),
  type        TEXT NOT NULL CHECK (type IN ('text', 'image', 'checklist', 'code', 'table', 'frame', 'file', 'shape', 'sticky', 'embed')),
  x           REAL NOT NULL DEFAULT 0,
  y           REAL NOT NULL DEFAULT 0,
  w           REAL NOT NULL DEFAULT 200,
  h           REAL NOT NULL DEFAULT 100,
  z           INTEGER NOT NULL DEFAULT 0,
  rotation    REAL NOT NULL DEFAULT 0,
  asset_id    TEXT REFERENCES assets(id),
  content     TEXT NOT NULL DEFAULT '{}',
  plain_text  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  device_id   TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_blocks_page    ON blocks(page_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_blocks_updated ON blocks(updated_at)`,
  `CREATE TABLE IF NOT EXISTS connectors (
  id            TEXT PRIMARY KEY,
  page_id       TEXT NOT NULL REFERENCES nodes(id),
  from_block_id TEXT NOT NULL REFERENCES blocks(id),
  to_block_id   TEXT NOT NULL REFERENCES blocks(id),
  label         TEXT,
  style         TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  device_id     TEXT NOT NULL,
  CHECK (from_block_id <> to_block_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_connectors_page ON connectors(page_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_connectors_updated ON connectors(updated_at)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_blocks USING fts5(
  block_id UNINDEXED, page_id UNINDEXED, body,
  tokenize = 'unicode61 remove_diacritics 2'
)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_nodes USING fts5(
  node_id UNINDEXED, type UNINDEXED, title,
  tokenize = 'unicode61 remove_diacritics 2'
)`,
  `CREATE TRIGGER IF NOT EXISTS blocks_fts_ai AFTER INSERT ON blocks
WHEN NEW.deleted_at IS NULL AND NEW.plain_text <> ''
BEGIN
  INSERT INTO search_blocks(block_id, page_id, body) VALUES (NEW.id, NEW.page_id, NEW.plain_text);
END`,
  `CREATE TRIGGER IF NOT EXISTS blocks_fts_au AFTER UPDATE ON blocks
BEGIN
  DELETE FROM search_blocks WHERE block_id = OLD.id;
  INSERT INTO search_blocks(block_id, page_id, body)
    SELECT NEW.id, NEW.page_id, NEW.plain_text
    WHERE NEW.deleted_at IS NULL AND NEW.plain_text <> '';
END`,
  `CREATE TRIGGER IF NOT EXISTS blocks_fts_ad AFTER DELETE ON blocks
BEGIN
  DELETE FROM search_blocks WHERE block_id = OLD.id;
END`,
  `CREATE TRIGGER IF NOT EXISTS nodes_fts_ai AFTER INSERT ON nodes
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO search_nodes(node_id, type, title) VALUES (NEW.id, NEW.type, NEW.title);
END`,
  `CREATE TRIGGER IF NOT EXISTS nodes_fts_au AFTER UPDATE ON nodes
BEGIN
  DELETE FROM search_nodes WHERE node_id = OLD.id;
  INSERT INTO search_nodes(node_id, type, title)
    SELECT NEW.id, NEW.type, NEW.title WHERE NEW.deleted_at IS NULL;
END`,
  `CREATE TRIGGER IF NOT EXISTS nodes_fts_ad AFTER DELETE ON nodes
BEGIN
  DELETE FROM search_nodes WHERE node_id = OLD.id;
END`,
  `CREATE VIEW IF NOT EXISTS v_backlinks AS
SELECT e.dst AS page_id, e.src AS source_page_id, e.props AS link_props
FROM edges e
JOIN nodes s ON s.id = e.src AND s.deleted_at IS NULL
JOIN nodes d ON d.id = e.dst AND d.deleted_at IS NULL
WHERE e.type = 'LINKS_TO' AND e.deleted_at IS NULL`,
  `CREATE VIEW IF NOT EXISTS v_page_tags AS
SELECT e.src AS page_id, t.id AS tag_id, t.title AS tag
FROM edges e
JOIN nodes t ON t.id = e.dst AND t.type = 'tag' AND t.deleted_at IS NULL
WHERE e.type = 'TAGGED' AND e.deleted_at IS NULL`,
  `CREATE VIEW IF NOT EXISTS v_tag_counts AS
SELECT t.id AS tag_id, t.title AS tag, COUNT(p.id) AS page_count
FROM nodes t
LEFT JOIN edges e ON e.dst = t.id AND e.type = 'TAGGED' AND e.deleted_at IS NULL
LEFT JOIN nodes p ON p.id = e.src AND p.type = 'page' AND p.deleted_at IS NULL
WHERE t.type = 'tag' AND t.deleted_at IS NULL
GROUP BY t.id`,
  `CREATE VIEW IF NOT EXISTS v_orphan_pages AS
SELECT n.*
FROM nodes n
WHERE n.type = 'page' AND n.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM edges e
    WHERE e.deleted_at IS NULL AND (e.src = n.id OR e.dst = n.id)
  )`,
];
