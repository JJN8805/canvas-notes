import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase, fakeFs, fakePath, fsRoots, useDevice } from './fakes';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: FakeDatabase }));
vi.mock('@tauri-apps/plugin-fs', () => fakeFs);
vi.mock('@tauri-apps/api/path', () => fakePath);

import { createTauriStorage } from '../src/storage/tauri';
import { assertSafeImage, isKnownImageType, isSafeId } from '../src/storage/validate';
import { parseBackup } from '../src/lib/backup';
import type { NotesStorage } from '../src/storage/types';

describe('ids and image types from outside the app', () => {
  it('accepts the ids the app makes and rejects anything that could name another file', () => {
    expect(isSafeId('lq3k9x1a2b3c4')).toBe(true);
    expect(isSafeId('a-b_C9')).toBe(true);
    for (const bad of ['', '../x', '..', 'a/b', 'a\\b', 'a.png', 'a b', '%2e%2e', 'x'.repeat(81), 7, null, undefined, { toString: () => 'ok' }]) {
      expect(isSafeId(bad), String(bad)).toBe(false);
    }
  });

  it('only knows real image types', () => {
    expect(isKnownImageType('image/png')).toBe(true);
    for (const bad of ['text/html', 'image/png/../x', '__proto__', 'constructor', '', undefined]) expect(isKnownImageType(bad), String(bad)).toBe(false);
    expect(() => assertSafeImage({ id: 'ok1', mime: 'image/png' })).not.toThrow();
    expect(() => assertSafeImage({ id: '../evil', mime: 'image/png' })).toThrow();
    expect(() => assertSafeImage({ id: 'ok1', mime: 'text/html' })).toThrow();
  });
});

describe('a backup file is untrusted', () => {
  it('drops images with unsafe ids or types', () => {
    const file = JSON.stringify({
      format: 'canvas-notes-backup',
      version: 1,
      pages: [],
      images: [
        { id: 'good1', mime: 'image/png', data: 'AAAA' },
        { id: '../../canvas-notes.db', mime: 'image/png', data: 'AAAA' },
        { id: 'good2', mime: 'application/x-sh', data: 'AAAA' },
      ],
    });
    expect(parseBackup(file).images.map((i) => i.id)).toEqual(['good1']);
  });
});

describe('storage refuses unsafe images from a sync peer', () => {
  let store: NotesStorage;
  beforeEach(async () => {
    useDevice('sec');
    fsRoots.get('sec')!.clear();
    store = await createTauriStorage();
  });

  it('writes a normal image but never a file outside the images folder', async () => {
    await store.sync.writeImage({ id: 'fine1', mime: 'image/png', data: btoa('x') });
    await expect(store.sync.writeImage({ id: '../canvas-notes', mime: 'image/png', data: btoa('pwn') })).rejects.toThrow(/unsafe/);
    const files = [...fsRoots.get('sec')!.keys()];
    expect(files.some((f) => f.includes('..'))).toBe(false);
    expect(files.some((f) => f.endsWith('fine1.png'))).toBe(true);
    expect(await store.sync.readImage('../canvas-notes')).toBeNull();
  });
});
