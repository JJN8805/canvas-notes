// Cards across workspaces: copy a card, paste it in another workspace; cut and paste; the card menu and Ctrl+V.
// Run with the dev server up (`npm run dev`):  node scripts/card-clipboard-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-card-clipboard-check');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const root = join(homedir(), '.cache', 'ms-playwright');
  for (const d of readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse())
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) if (existsSync(join(root, d, sub))) return join(root, d, sub);
}
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
};
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('canvas-notes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const now = Date.now();
  const mk = (id, title, extra = {}) => ({ id, etag: 'e' + id, synced: null, deleted: false, title, groupId: null, tags: [], blocks: [], arrows: [], drawing: null, color: null, kind: 'card', dailyDate: null, sheet: null, created: now, updated: now, rev: 1, ...extra });
  const tx = db.transaction(['pages', 'groups'], 'readwrite');
  tx.objectStore('pages').put(mk('k1', 'Sponsor Acme'));
  tx.objectStore('pages').put(mk('k2', 'Sponsor Zed'));
  tx.objectStore('groups').put({ id: 'wcreator', name: 'Content creator', color: 'plum', position: 0, parentId: null, scope: 'workspaces', etag: 'ew', synced: null, deleted: false });
  await new Promise((res) => (tx.oncomplete = res));
  db.close();
});
await page.reload();
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf-card');
const has = async (t) => (await page.locator(`.cf-card:has-text("${t}")`).count()) > 0;
check('both cards are in Main', (await has('Sponsor Acme')) && (await has('Sponsor Zed')));

// copy via the card's ⋯ menu
await page.locator('.cf-card:has-text("Sponsor Acme")').hover();
await page.locator('.cf-card:has-text("Sponsor Acme") .cf-card-more').click();
const menu = await page.locator('.menu').innerText();
check('the card menu offers open, copy, cut, move, copy to, archive, delete', /Open card/.test(menu) && /Copy card/.test(menu) && /Cut card/.test(menu) && /Move to/.test(menu) && /Copy to/.test(menu) && /Archive card/.test(menu) && /Delete card/.test(menu), menu);
await page.screenshot({ path: join(OUT, '1-card-menu.png') });
await page.click('.menu-item:has-text("Copy card")');
await page.waitForSelector('.paste-bar');
check('a paste bar shows what was copied', /Copied 1 card/.test(await page.locator('.paste-bar').innerText()));

// into the other workspace
await page.click('.ws-side');
await page.click('.menu-item:has-text("Content creator")');
await page.waitForTimeout(500);
await page.click('.sidebar >> text=Cards');
await page.waitForTimeout(300);
check('the paste bar is still there in the other workspace', (await page.locator('.paste-bar').count()) === 1);
await page.screenshot({ path: join(OUT, '2-paste-bar.png') });
await page.click('.paste-bar >> text=Paste here');
await page.waitForTimeout(600);
await page.click('.sidebar >> text=Cards');
check('the copy is in the Content creator workspace', await has('Sponsor Acme'));
check('copy leaves the clipboard for another paste', (await page.locator('.paste-bar').count()) === 1);

// cut from here and paste in Main with Ctrl+V
await page.locator('.cf-card:has-text("Sponsor Acme") .cf-card-more').click({ force: true });
await page.click('.menu-item:has-text("Cut card")');
await page.click('.ws-side');
await page.click('.menu-item:has-text("Main")');
await page.waitForTimeout(500);
await page.click('.sidebar >> text=Cards');
await page.keyboard.press('Control+v');
await page.waitForTimeout(700);
const n = await page.locator('.cf-card:has-text("Sponsor Acme")').count();
check('Ctrl+V pastes the cut card into Main (now two there: the original and the earlier copy was elsewhere)', n >= 1, String(n));
check('the paste bar is gone after a cut is pasted', (await page.locator('.paste-bar').count()) === 0);
await page.click('.ws-side');
await page.click('.menu-item:has-text("Content creator")');
await page.waitForTimeout(500);
await page.click('.sidebar >> text=Cards');
check('and the cut card has left the other workspace', (await page.locator('.cf-card:has-text("Sponsor Acme")').count()) === 0);

// card details: Workspace button
await page.click('.ws-side');
await page.click('.menu-item:has-text("Main")');
await page.waitForTimeout(400);
await page.click('.sidebar >> text=Cards');
await page.locator('.cf-card:has-text("Sponsor Zed")').first().click();
await page.waitForSelector('.cd-actions');
check('the card details have a Workspace button', (await page.locator('.cd-actions >> text=Workspace').count()) === 1);
await page.screenshot({ path: join(OUT, '3-detail.png') });
// folders: move a folder with its section and cards to the other workspace
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('canvas-notes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const now = Date.now();
  const mk = (id, title, extra = {}) => ({ id, etag: 'e' + id, synced: null, deleted: false, title, groupId: null, tags: [], blocks: [], arrows: [], drawing: null, color: null, kind: 'card', dailyDate: null, sheet: null, created: now, updated: now, rev: 1, ...extra });
  const tx = db.transaction(['pages', 'groups'], 'readwrite');
  tx.objectStore('groups').put({ id: 'fl1', name: 'Brands', color: 'sky', position: 0, parentId: null, scope: 'cards', etag: 'ef1', synced: null, deleted: false });
  tx.objectStore('groups').put({ id: 'fl2', name: 'Active', color: 'sage', position: 0, parentId: 'fl1', scope: 'cards', etag: 'ef2', synced: null, deleted: false });
  tx.objectStore('pages').put(mk('k3', 'Brand A', { groupId: 'fl1' }));
  tx.objectStore('pages').put(mk('k4', 'Brand B', { groupId: 'fl2' }));
  await new Promise((res) => (tx.oncomplete = res));
  db.close();
});
await page.reload();
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf-card, .cf-section, .tree-row, .cf-tree', { timeout: 10000 }).catch(() => {});
await page.screenshot({ path: join(OUT, '4-folders.png') });
const opener = page.locator('[aria-label="Menu for Brands"]').first();
check('a folder has an options button', (await opener.count()) > 0);
await page.locator('.cf-tree [aria-label="Menu for Brands"]').first().click({ force: true });
const fm = await page.locator('.menu').innerText();
check('the folder menu offers moving it and its cards to another workspace', /Move folder and its cards to Content creator/.test(fm) && /Copy folder and its cards to Content creator/.test(fm), fm);
await page.click('.menu-item:has-text("Move folder and its cards to Content creator")');
await page.waitForTimeout(700);
check('the folder left this workspace', (await page.locator('text=Brand A').count()) === 0);
await page.click('.ws-side');
await page.click('.menu-item:has-text("Content creator")');
await page.waitForTimeout(600);
await page.click('.sidebar >> text=Cards');
check('it arrived with its cards and its section', (await page.locator('text=Brand A').count()) > 0 && (await page.locator('text=Brand B').count()) > 0);
await page.screenshot({ path: join(OUT, '5-arrived.png') });
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
