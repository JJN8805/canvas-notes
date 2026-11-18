// Picking several pages in the library to archive, move or delete together.
// Run with the dev server up (`npm run dev`):  node scripts/select-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-select-check');
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
  for (const n of ['Alpha', 'Beta']) tx.objectStore('pages').put({ ...p, id: 'x' + n, etag: 'e' + n, title: n, blocks: [], updated: now - 1000 });
  await new Promise((res) => (tx.oncomplete = res));
  db.close();
});
await page.reload();
await page.waitForSelector('.sidebar');
await page.waitForTimeout(800);
await page.click('.card:has-text("Plan")');
await page.waitForSelector('.world', { timeout: 8000 }).catch(async (e) => { console.log('HASH', await page.evaluate(() => location.hash), (await page.locator('body').innerText()).slice(0, 300), errors); throw e; });
await page.waitForTimeout(800);



await page.evaluate(() => (location.hash = '#/'));
await page.waitForSelector('.sidebar');
await page.click('.nav-item:has-text("All pages")');
const cards = () => page.locator('.card:not(.archived)').count();
check('three pages to start with', (await cards()) === 3, String(await cards()));

/* ---- start picking ---- */
await page.click('.controls button:has-text("Select")');
check('Select shows a tick circle on every card and a bar', (await page.locator('.card-check').count()) === 3 && (await page.locator('.select-bar').count()) === 1);
check('nothing is picked yet and Archive/Delete wait', /Pick pages/.test(await page.locator('.select-count').innerText()) && (await page.locator('.select-bar button:has-text("Delete")').isDisabled()));
await page.click('.card:has-text("Alpha")');
await page.click('.card:has-text("Beta")');
check('tapping cards picks them (and does not open them)', /2 pages picked/.test(await page.locator('.select-count').innerText()) && (await page.locator('.card.picked').count()) === 2 && (await page.locator('.world').count()) === 0);
await page.click('.card:has-text("Beta")');
check('tapping a picked card unpicks it', /1 page picked/.test(await page.locator('.select-count').innerText()));
await page.click('.select-bar button:has-text("Pick all")');
check('Pick all picks everything shown', /3 pages picked/.test(await page.locator('.select-count').innerText()));
await page.screenshot({ path: join(OUT, 'picking.png') });
await page.click('.select-bar button:has-text("Pick none")');

/* ---- archive two at once, with one Undo ---- */
await page.click('.card:has-text("Alpha")');
await page.click('.card:has-text("Beta")');
await page.click('.select-bar button:has-text("Archive")');
await page.waitForTimeout(400);
check('Archive puts both away at once and ends picking', (await cards()) === 1 && (await page.locator('.select-bar').count()) === 0);
check('with one message for both', /Archived 2 pages/.test(await page.locator('.toast, [role=status]').first().innerText().catch(() => '')));
await page.locator('.toast button:has-text("Undo"), [role=status] button:has-text("Undo")').first().click();
await page.waitForTimeout(400);
check('and one Undo brings both back', (await cards()) === 3);

/* ---- move to a group ---- */
await page.click('.nav-item:has-text("Groups")');
await page.click('button:has-text("New group")');
await page.waitForSelector('.dialog input');
await page.fill('.dialog input', 'Work');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await page.click('.nav-item:has-text("All pages")');
await page.click('.controls button:has-text("Select")');
await page.click('.card:has-text("Alpha")');
await page.click('.card:has-text("Beta")');
await page.click('.select-bar button:has-text("Move to")');
await page.click('.menu-item:has-text("Work")');
await page.waitForTimeout(400);
check('Move to… puts the picked pages in the group', (await page.locator('.card.grouped').count()) === 2);

/* ---- Ctrl+click starts picking on a laptop, Escape ends it ---- */
await page.click('.card:has-text("Plan")', { modifiers: ['Control'] });
check('Ctrl+click on a card starts picking with it picked', (await page.locator('.select-bar').count()) === 1 && (await page.locator('.card.picked').count()) === 1);
await page.keyboard.press('Escape');
check('Escape ends picking', (await page.locator('.select-bar').count()) === 0 && (await page.locator('.card-check').count()) === 0);

/* ---- delete two at once ---- */
await page.click('.controls button:has-text("Select")');
await page.click('.card:has-text("Alpha")');
await page.click('.card:has-text("Beta")');
await page.click('.select-bar button:has-text("Delete")');
await page.waitForSelector('.dialog');
check('Delete asks once for all of them', /Delete 2 pages/.test(await page.locator('.dialog').innerText()));
await page.click('.dialog button:has-text("Delete")');
await page.waitForTimeout(500);
check('and they are gone from the library', (await cards()) === 1);
await page.click('.nav-item:has-text("Trash")');
await page.waitForSelector('.card.trashed');
check('both are in the Trash', (await page.locator('.card.trashed').count()) === 2);

/* ---- leaving the screen ends picking ---- */
await page.click('.nav-item:has-text("All pages")');
await page.click('.controls button:has-text("Select")');
await page.click('.nav-item:has-text("Tags")');
check('going to another screen ends picking', (await page.locator('.select-bar').count()) === 0);

check('no console errors', errors.length === 0, errors.join(' | '));
console.log('screenshots in', OUT);
await browser.close();
process.exit(failed ? 1 : 0);
