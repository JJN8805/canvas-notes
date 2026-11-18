// The Archive: archive a page and a card, see it leave the library and search, restore it, delete it from the archive.
// Run with the dev server up (`npm run dev`):  node scripts/archive-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-archive-check');
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
  const note = (id, html, x, y, extra = {}) => ({ id, type: 'note', style: 'text', x, y, w: 240, h: 70, z: 1, html, ...extra });
  const blocks = [
    note('n1', '<p>Idea one</p>', 0, 0, { style: 'sticky', tint: 'yellow', w: 200, h: 160, z: 1 }),
    note('n2', '<p>Idea two</p>', 40, 30, { style: 'sticky', tint: 'blue', w: 200, h: 160, z: 2 }),
    note('n3', '<h1>Background reading</h1><p>Papers and links</p>', 320, 0, { z: 3 }),
    note('n4', '<p>Pinned note</p>', 320, 140, { z: 4, locked: true }),
    { id: 'f1', type: 'frame', x: -30, y: -50, w: 620, h: 320, z: 0, title: 'Project', color: 'slate', collapsed: false },
  ];
  const p = { id: 'sp', etag: 'esp', synced: null, deleted: false, title: 'Plan', groupId: null, tags: [], blocks, arrows: [], drawing: null, color: null, kind: 'page', dailyDate: null, sheet: null, created: now, updated: now, rev: 1 };
  const tx = db.transaction(['pages'], 'readwrite');
  tx.objectStore('pages').put(p);
  await new Promise((res) => (tx.oncomplete = res));
  db.close();
});
await page.reload();
await page.waitForSelector('.sidebar');
await page.waitForTimeout(800);
await page.click('.card:has-text("Plan")');
await page.waitForSelector('.world', { timeout: 8000 }).catch(async (e) => { console.log('HASH', await page.evaluate(() => location.hash), (await page.locator('body').innerText()).slice(0, 300), errors); throw e; });
await page.waitForTimeout(800);



const count = () => page.locator('.card:not(.archived)').count();
/* ---- from the page's header ---- */
check('the page header has an Archive button', (await page.locator('.ed-archive').count()) === 1);
await page.click('.ed-archive');
await page.waitForSelector('.sidebar');
check('archiving a page from its header goes back to the library', true);
await page.waitForTimeout(400);
check('and the page has left the library (All pages)', (await page.locator('.card:has-text("Plan")').count()) === 0);
check('an "Archived … Undo" message appears', /Archived/.test(await page.locator('.toast, [role=status]').first().innerText().catch(() => '')));
check('the sidebar counts it under Archive', /1/.test(await page.locator('.nav-item:has-text("Archive")').innerText()));
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette');
await page.fill('.palette input', 'Plan');
await page.waitForTimeout(200);
check('and the quick switcher no longer finds it', (await page.locator('.palette-row:has-text("Plan")').count()) === 0);
await page.keyboard.press('Escape');

/* ---- the Archive screen ---- */
await page.click('.nav-item:has-text("Archive")');
await page.waitForSelector('.card.archived');
check('the Archive screen lists it with Restore, Open and Delete', (await page.locator('.card.archived:has-text("Plan") button').allInnerTexts()).join(',').match(/Restore.*Open.*Delete/) !== null);
await page.screenshot({ path: join(OUT, 'archive.png') });
await page.click('.card.archived:has-text("Plan") button:has-text("Open")');
await page.waitForSelector('.world');
check('an archived page opens, and its header offers Restore', /Restore/.test(await page.locator('.ed-archive').getAttribute('aria-label')));
await page.evaluate(() => (location.hash = '#/'));
await page.waitForSelector('.sidebar');
await page.click('.nav-item:has-text("Archive")');
await page.click('.card.archived:has-text("Plan") button:has-text("Restore")');
await page.waitForTimeout(300);
check('Restore empties the Archive', (await page.locator('.card.archived').count()) === 0 && (await page.locator('.empty h2').innerText()) === 'The Archive is empty');
await page.click('.nav-item:has-text("All pages")');
check('and the page is back in the library', (await page.locator('.card:has-text("Plan")').count()) === 1);

/* ---- from the card menu in the library ---- */
await page.locator('.card:has-text("Plan") [aria-label^="Options for"]').click();
await page.click('.menu-item:has-text("Archive")');
await page.waitForTimeout(300);
check('the page card menu archives too', (await page.locator('.card:has-text("Plan")').count()) === 0);
await page.locator('.toast button:has-text("Undo"), [role=status] button:has-text("Undo")').first().click().catch(() => {});
await page.waitForTimeout(300);
check('and Undo in the message puts it back', (await page.locator('.card:has-text("Plan")').count()) === 1);

/* ---- delete from the archive goes to Trash ---- */
await page.locator('.card:has-text("Plan") [aria-label^="Options for"]').click();
await page.click('.menu-item:has-text("Archive")');
await page.click('.nav-item:has-text("Archive")');
await page.click('.card.archived:has-text("Plan") button:has-text("Delete")');
await page.waitForSelector('.dialog');
await page.click('.dialog button:has-text("Delete")');
await page.waitForTimeout(500);
check('Delete in the Archive moves it to Trash (where it can be restored)', (await page.locator('.card.archived').count()) === 0);
await page.click('.nav-item:has-text("Trash")');
await page.waitForSelector('.card.trashed');
check('it is in the Trash', (await page.locator('.card.trashed:has-text("Plan")').count()) === 1);

check('no console errors', errors.length === 0, errors.join(' | '));
console.log('screenshots in', OUT);
await browser.close();
process.exit(failed ? 1 : 0);
