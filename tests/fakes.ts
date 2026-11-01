// Test doubles for the Tauri plugins: real SQLite (node:sqlite) and an in-memory file system.
import { DatabaseSync } from 'node:sqlite';

export const fsRoots = new Map<string, Map<string, Uint8Array>>();
export let currentDevice = 'laptop';
export function useDevice(name: string) {
  currentDevice = name;
  if (!fsRoots.has(name)) fsRoots.set(name, new Map());
}
const fs = () => fsRoots.get(currentDevice)!;

export class FakeDatabase {
  db = new DatabaseSync(':memory:');
  /** Targets of every `VACUUM INTO` (database backups) requested, in order. */
  static backups: string[] = [];
  /** Makes `VACUUM INTO` fail, like a full disk. */
  static failBackup = false;
  /** Set to make the next load() open this database (to test upgrades). */
  static next: FakeDatabase | null = null;
  static async load() {
    const d = FakeDatabase.next ?? new FakeDatabase();
    FakeDatabase.next = null;
    return d;
  }
  private prep(sql: string) {
    // The SQL plugin uses $1, $2…; SQLite's numbered form is ?1, ?2…
    return this.db.prepare(sql.replace(/\$(\d+)/g, '?$1'));
  }
  private args(p: unknown[] = []) {
    return p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)) as never[];
  }
  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    return this.prep(sql).all(...this.args(params)) as T;
  }
  async execute(sql: string, params?: unknown[]) {
    if (/^\s*VACUUM INTO/i.test(sql)) {
      if (FakeDatabase.failBackup) throw new Error('disk full');
      FakeDatabase.backups.push(String(params?.[0]));
      return { rowsAffected: 0, lastInsertId: 0 };
    }
    const r = this.prep(sql).run(...this.args(params));
    return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  }
}

export const fakeFs = {
  BaseDirectory: { AppConfig: 'AppConfig' },
  mkdir: async () => {},
  writeFile: async (path: string, data: Uint8Array) => void fs().set(path, new Uint8Array(data)),
  readFile: async (path: string) => {
    const f = fs().get(path);
    if (!f) throw new Error('not found: ' + path);
    return f;
  },
  remove: async (path: string) => void fs().delete(path),
};

export const fakePath = { appConfigDir: async () => '/config', join: async (...parts: string[]) => parts.join('/') };
