import { describe, expect, it } from 'vitest';
import { CLIENT_TOO_OLD, DATA_FORMAT, handleRequest, PEER_TOO_OLD, peerTooOld, syncWithLaptop, type SyncRequest } from '../src/sync/engine';
import type { SyncStore } from '../src/storage/types';

const store = { listMeta: async () => [], listImageIds: async () => [] } as unknown as SyncStore;

describe('syncing between versions that write pages differently', () => {
  it('a peer that says nothing is taken to be format 1, too old', () => {
    expect(peerTooOld({})).toBe(true);
    expect(peerTooOld({ format: 1 })).toBe(true);
    expect(peerTooOld({ format: DATA_FORMAT })).toBe(false);
  });
  it('the laptop tells the phone its format, and always answers hello', async () => {
    expect(await handleRequest(store, { op: 'hello' }, { minFormat: DATA_FORMAT })).toMatchObject({ app: 'canvas-notes', format: DATA_FORMAT });
  });
  it('the laptop refuses a phone that does not say it is current, but not a current one', async () => {
    const hooks = { minFormat: DATA_FORMAT };
    await expect(handleRequest(store, { op: 'manifest' }, hooks)).rejects.toThrow(CLIENT_TOO_OLD);
    await expect(handleRequest(store, { op: 'manifest', format: 1 }, hooks)).rejects.toThrow(CLIENT_TOO_OLD);
    await expect(handleRequest(store, { op: 'manifest', format: DATA_FORMAT }, hooks)).resolves.toBeTruthy();
  });
  it('without the setting every request is answered (tests, other uses)', async () => {
    await expect(handleRequest(store, { op: 'manifest' })).resolves.toBeTruthy();
  });
  it('the phone stops before sending or fetching anything when the laptop is old', async () => {
    const seen: string[] = [];
    const oldLaptop = async <T,>(req: SyncRequest): Promise<T> => {
      seen.push(req.op);
      return { app: 'canvas-notes', protocol: 1 } as T; // an older laptop: no format
    };
    await expect(syncWithLaptop(store, oldLaptop)).rejects.toThrow(PEER_TOO_OLD);
    expect(seen).toEqual(['hello']);
  });
});
