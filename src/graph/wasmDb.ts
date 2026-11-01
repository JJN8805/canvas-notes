import { syncDb, type GraphDb } from './db';
import { GRAPH_SCHEMA } from './schema';

// Just the slice of @sqlite.org/sqlite-wasm that we call.
interface WasmDb {
  exec(opts: { sql: string; bind?: unknown[]; rowMode?: 'object'; returnValue?: 'resultRows' }): unknown[];
  changes(): number;
}
interface Sqlite3 {
  oo1: { DB: new (filename: string) => WasmDb };
}

/**
 * An in-memory SQLite running as WebAssembly, with the graph schema applied.
 * Used only by the browser dev server (`npm run dev`); the desktop app uses real SQLite.
 * `init` is injectable so tests can load the Node build.
 */
export async function openWasmDb(init?: () => Promise<Sqlite3>): Promise<GraphDb> {
  const load = init ?? (async () => (await import('@sqlite.org/sqlite-wasm')).default() as unknown as Sqlite3);
  const sqlite = await load();
  const db = new sqlite.oo1.DB(':memory:');
  const g = syncDb({
    run: (sql, params) => {
      db.exec({ sql, bind: params.length ? params : undefined });
      return db.changes();
    },
    all: (sql, params) => db.exec({ sql, bind: params.length ? params : undefined, rowMode: 'object', returnValue: 'resultRows' }),
  });
  for (const stmt of GRAPH_SCHEMA) await g.execute(stmt);
  return g;
}
