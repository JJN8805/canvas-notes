import type { Page } from '../types';
import { adopt, splitGroups, workspaceOf } from '../lib/workspaces';
import { captureBlock, cleanCapture, INBOX_TITLE } from '../lib/capture';
import { sheetForContent } from '../lib/sheet';
import { newId } from '../lib/util';
import { flushAll, getStorage, refreshFromDisk, get } from './notes';
import { toast } from './ui';
import { workspaceName } from './workspaces';

/**
 * Adds a note to the "Inbox" page of a workspace (made on the first capture), whichever workspace is open. It works from the stored copy,
 * so the open workspace's unsaved edits are saved first. Returns the Inbox page's id, or null when there was nothing to add.
 */
export async function captureTo(workspace: string, text: string): Promise<string | null> {
  const clean = cleanCapture(text);
  if (!clean) return null;
  await flushAll();
  const storage = getStorage();
  const loaded = await storage.loadAll();
  const rows = splitGroups(loaded.groups, null).workspaces;
  const inbox = adopt(loaded.pages, rows).find((p) => p.kind !== 'template' && !p.archived && !p.dailyDate && workspaceOf(p) === workspace && p.title.trim() === INBOX_TITLE) ?? null;
  let id: string;
  if (inbox) {
    id = inbox.id;
    await storage.savePage({ ...inbox, blocks: [...inbox.blocks, captureBlock(inbox.blocks, clean)], updated: Date.now() });
  } else {
    const now = Date.now();
    const blocks = [captureBlock([], clean)];
    const page: Page = { id: (id = newId()), title: INBOX_TITLE, groupId: null, tags: [], blocks, arrows: [], created: now, updated: now, rev: 0, sheet: sheetForContent(blocks), ...(workspace ? { workspace } : {}) };
    await storage.savePage(page);
  }
  await refreshFromDisk();
  toast(`Added to ${INBOX_TITLE} in ${workspaceName(workspace)}`, workspace === (get().workspace ?? '') ? { label: 'Open', run: () => void import('./workspaces').then((m) => m.openPageAnywhere(id)) } : undefined);
  return id;
}
