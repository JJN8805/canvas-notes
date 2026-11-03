import { describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { buildBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import { decryptBackupText, encryptBackupText, isEncryptedBackup } from '../src/lib/backupCrypto';

describe('encrypted backups', () => {
  const plain = JSON.stringify({ format: 'canvas-notes-backup', pages: [{ id: 'a', title: 'Secret plans ✓ ünïcode' }] });

  it('round-trips with the same passphrase', async () => {
    const file = await encryptBackupText(plain, 'correct horse');
    expect(await decryptBackupText(file, 'correct horse')).toBe(plain);
  });

  it('keeps the notes unreadable in the file', async () => {
    const file = await encryptBackupText(plain, 'pw');
    expect(file).not.toContain('Secret');
    expect(file).not.toContain('plans');
  });

  it('uses a fresh salt and nonce every time', async () => {
    const a = JSON.parse(await encryptBackupText(plain, 'pw'));
    const b = JSON.parse(await encryptBackupText(plain, 'pw'));
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('refuses a wrong passphrase with a readable message', async () => {
    const file = await encryptBackupText(plain, 'right');
    await expect(decryptBackupText(file, 'wrong')).rejects.toThrow(/Wrong passphrase/);
    await expect(decryptBackupText(file, '')).rejects.toThrow(/Wrong passphrase/);
  });

  it('refuses a file that was tampered with', async () => {
    const env = JSON.parse(await encryptBackupText(plain, 'pw'));
    const bytes = Buffer.from(env.data, 'base64');
    bytes[3] ^= 1;
    env.data = bytes.toString('base64');
    await expect(decryptBackupText(JSON.stringify(env), 'pw')).rejects.toThrow(/Wrong passphrase|damaged/);
  });

  it('treats equivalent unicode passphrases alike', async () => {
    const file = await encryptBackupText(plain, 'café'); // é as one character
    expect(await decryptBackupText(file, 'café')).toBe(plain); // e + combining accent
  });

  it('will not choose an empty passphrase, and rejects absurd work factors', async () => {
    await expect(encryptBackupText(plain, '')).rejects.toThrow();
    const env = JSON.parse(await encryptBackupText(plain, 'pw'));
    env.iterations = 4_000_000_000;
    await expect(decryptBackupText(JSON.stringify(env), 'pw')).rejects.toThrow(/damaged/);
  });

  it('recognises its own files and nothing else', async () => {
    expect(isEncryptedBackup(await encryptBackupText(plain, 'pw'))).toBe(true);
    expect(isEncryptedBackup(plain)).toBe(false);
    expect(isEncryptedBackup('not json')).toBe(false);
    await expect(decryptBackupText(plain, 'pw')).rejects.toThrow(/encrypted/);
  });
});

describe('an encrypted backup of a real library', () => {
  it('restores into another library with the right passphrase, and not without it', async () => {
    useDevice('enc-a');
    const a = await createTauriStorage();
    await a.savePage({ id: 'p1', title: 'Private diary', groupId: null, tags: ['secret'], blocks: [], arrows: [], created: 1, updated: 1, rev: 0 });
    const file = await encryptBackupText(JSON.stringify(await buildBackup(a)), 'hunter2');
    expect(file).not.toContain('Private diary');

    useDevice('enc-b');
    const b = await createTauriStorage();
    await expect(decryptBackupText(file, 'hunter3')).rejects.toThrow(/Wrong passphrase/);
    const r = await restoreBackup(b, parseBackup(await decryptBackupText(file, 'hunter2')));
    expect(r.pages).toBe(1);
    expect((await b.loadAll()).pages.find((p) => p.id === 'p1')).toMatchObject({ title: 'Private diary', tags: ['secret'] });
  });
});
