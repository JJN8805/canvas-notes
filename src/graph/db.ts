/** The few database calls the graph layer needs. Three backends implement it:
 *  the Tauri SQL plugin (desktop), the WASM SQLite (browser dev server), node:sqlite (tests). */
export interface GraphDb {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` atomically where the backend can (see pluginDb). Nested calls join the outer one. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** What the Tauri SQL plugin's Database looks like to us. */
interface PluginDatabase {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

/**
 * Desktop adapter. The plugin keeps a pool of connections, so a JS-level BEGIN/COMMIT could
 * land on different connections and is unsafe: `transaction` just runs `fn`. Graph writes
 * therefore have to be idempotent (re-running them repairs a half-finished one), and
 * GraphMirror runs them one at a time.
 */
export function pluginDb(db: PluginDatabase): GraphDb {
  return {
    execute: (sql, params) => db.execute(sql, params),
    select: <T,>(sql: string, params?: unknown[]) => db.select<T[]>(sql, params),
    transaction: (fn) => fn(),
  };
}

/** A synchronous single-connection SQLite (node:sqlite, sqlite-wasm). */
export interface SyncDriver {
  run(sql: string, params: unknown[]): number;
  all(sql: string, params: unknown[]): unknown[];
}

/** Real BEGIN/COMMIT with a lock, so two async callers can't interleave inside one transaction. */
export function syncDb(driver: SyncDriver): GraphDb {
  let depth = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const norm = (p?: unknown[]) => (p ?? []).map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  // Callers write $1, $2…; SQLite's numbered form is ?1, ?2…
  const q = (sql: string) => sql.replace(/\$(\d+)/g, '?$1');
  return {
    async execute(sql, params) {
      return { rowsAffected: driver.run(q(sql), norm(params)) };
    },
    async select<T>(sql: string, params?: unknown[]) {
      return driver.all(q(sql), norm(params)) as T[];
    },
    async transaction<T>(fn: () => Promise<T>) {
      if (depth > 0) return fn();
      const run = async () => {
        driver.run('BEGIN', []);
        depth = 1;
        try {
          const out = await fn();
          driver.run('COMMIT', []);
          return out;
        } catch (e) {
          driver.run('ROLLBACK', []);
          throw e;
        } finally {
          depth = 0;
        }
      };
      const p = tail.then(run, run);
      tail = p.catch(() => {});
      return p;
    },
  };
}
