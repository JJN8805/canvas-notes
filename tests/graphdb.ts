import { DatabaseSync } from 'node:sqlite';
import { syncDb, type GraphDb } from '../src/graph/db';
import { GraphRepo } from '../src/graph/repo';
import { GRAPH_SCHEMA } from '../src/graph/schema';

/** An in-memory SQLite with the graph schema applied and foreign keys enforced. */
export async function memoryGraph(deviceId = 'dev-A', clock?: () => number) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db: GraphDb = syncDb({
    run: (sql, p) => Number(sqlite.prepare(sql).run(...(p as never[])).changes),
    all: (sql, p) => sqlite.prepare(sql).all(...(p as never[])),
  });
  for (const stmt of GRAPH_SCHEMA) await db.execute(stmt);
  let t = 1000;
  const repo = new GraphRepo(db, deviceId, clock ?? (() => ++t));
  await repo.ensureDevice(deviceId, 'Test');
  return { sqlite, db, repo };
}
