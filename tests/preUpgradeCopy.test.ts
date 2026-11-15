import { describe, expect, it } from 'vitest';
import { copyBeforeUpgrade, folderName, KEEP, parseState, STATE_FILE, type CopyFs } from '../src/storage/preUpgradeCopy';

function memFs(initial: Record<string, string> = {}) {
  const files = new Map<string, Uint8Array>(Object.entries(initial).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  const fs: CopyFs = {
    read: async (p) => files.get(p) ?? null,
    write: async (p, b) => void files.set(p, b),
    mkdir: async () => {},
    remove: async (p) => {
      for (const k of [...files.keys()]) if (k === p || k.startsWith(p + '/')) files.delete(k);
    },
  };
  return { fs, files, text: (p: string) => (files.has(p) ? new TextDecoder().decode(files.get(p)) : null) };
}
const T = Date.UTC(2026, 10, 14, 9, 8, 7);

describe('the safety copy before a new version opens the notes', () => {
  it('names folders from the version and the time, safely', () => {
    expect(folderName('0.1.0', T)).toBe('pre-0.1.0-20261114-090807');
    expect(folderName('../../x y', T)).toBe('pre-.._.._x_y-20261114-090807');
  });
  it('copies the database (and its journal) the first time, and remembers the version', async () => {
    const m = memFs({ 'canvas-notes.db': 'DB', 'canvas-notes.db-wal': 'WAL' });
    const r = await copyBeforeUpgrade(m.fs, '0.1.0', T);
    expect(r.made).toBe('pre-0.1.0-20261114-090807');
    expect(m.text(`backups/${r.made}/canvas-notes.db`)).toBe('DB');
    expect(m.text(`backups/${r.made}/canvas-notes.db-wal`)).toBe('WAL');
    expect(parseState(m.text(STATE_FILE))).toEqual({ version: '0.1.0', copies: [r.made] });
  });
  it('does nothing when the same version opens it again', async () => {
    const m = memFs({ 'canvas-notes.db': 'DB' });
    await copyBeforeUpgrade(m.fs, '0.1.0', T);
    const before = [...m.files.keys()].sort();
    expect((await copyBeforeUpgrade(m.fs, '0.1.0', T + 5000)).made).toBeNull();
    expect([...m.files.keys()].sort()).toEqual(before);
  });
  it('a first start with no database copies nothing but still remembers the version', async () => {
    const m = memFs();
    expect((await copyBeforeUpgrade(m.fs, '0.1.0', T)).made).toBeNull();
    expect(parseState(m.text(STATE_FILE))?.version).toBe('0.1.0');
  });
  it('keeps only the newest copies', async () => {
    const m = memFs({ 'canvas-notes.db': 'DB' });
    for (let i = 0; i < KEEP + 2; i++) await copyBeforeUpgrade(m.fs, `0.${i}.0`, T + i * 1000);
    const state = parseState(m.text(STATE_FILE))!;
    expect(state.copies).toHaveLength(KEEP);
    expect([...m.files.keys()].filter((k) => k.startsWith('backups/') && k.endsWith('canvas-notes.db'))).toHaveLength(KEEP);
    expect(m.text(`backups/${folderName('0.0.0', T)}/canvas-notes.db`)).toBeNull(); // the oldest went
  });
  it('does not trust a damaged or hostile state file', async () => {
    expect(parseState('not json')).toBeNull();
    expect(parseState(JSON.stringify({ version: 3, copies: [] }))).toBeNull();
    expect(parseState(JSON.stringify({ version: '1', copies: ['../../etc', 'pre-1-20260101-000000', 5] }))).toEqual({ version: '1', copies: ['pre-1-20260101-000000'] });
  });
});
