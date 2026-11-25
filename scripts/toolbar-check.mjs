// The laptop library toolbar: search, sort, Select, the New split button and its menu; sync in the sidebar; "/" focuses the search.
// Run with the dev server up (`npm run dev`):  node scripts/toolbar-check.mjs   (screenshots in /tmp/canvas-toolbar-check)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-toolbar-check');
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
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font|Fullscreen/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));
await page.goto(URL);
await page.waitForSelector('.sidebar');
// forty pages, so the toolbar has everything (Select needs pages) and the list can scroll
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('canvas-notes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const now = Date.now();
  const tx = db.transaction(['pages'], 'readwrite');
  for (let i = 0; i < 40; i++) tx.objectStore('pages').put({ id: 'bulk' + i, etag: 'eb' + i, synced: null, deleted: false, title: 'Bulk page ' + i, groupId: null, tags: [], blocks: [], arrows: [], drawing: null, color: null, kind: 'page', dailyDate: null, sheet: null, created: now - i, updated: now - i, rev: 1 });
  await new Promise((res) => (tx.oncomplete = res));
  db.close();
});
await page.reload();
await page.waitForSelector('.lib-head');
await page.waitForTimeout(500);

const lbl = async (sel) => (await page.locator(sel).allInnerTexts()).map((t) => t.trim());
const controls = await page.locator('.lib-head .controls > *').evaluateAll((els) => els.map((e) => e.className));
check('the toolbar has search, sort, a divider and the New split button', controls.some((c) => c.includes('search-wrap')) && controls.some((c) => c.includes('sort-wrap')) && controls.some((c) => c.includes('tool-sep')) && controls.some((c) => c.includes('split-btn')), controls.join(' | '));
check('Sync is no longer in the toolbar (it is in the sidebar)', (await page.locator('.lib-head .sync-btn').count()) === 0 && (await page.locator('.sidebar .side-sync .sync-btn').count()) === 1);
check('the toolbar stays on one line', await page.locator('.lib-head .controls').evaluate((el) => el.getBoundingClientRect().height < 60));
await page.screenshot({ path: join(OUT, '1-toolbar.png') });

await page.click('.split-caret');
await page.waitForSelector('.menu');
const items = await lbl('.menu .menu-item');
check('the arrow opens the New menu with every kind', ['Page', 'Card', 'Document', 'Spreadsheet', 'Presentation', 'Script'].every((l) => items.some((t) => t.startsWith(l))), items.join('|'));
await page.screenshot({ path: join(OUT, '2-split-menu.png') });
await page.keyboard.press('Escape');

await page.click('.lib-head h1');
await page.keyboard.press('/');
check('"/" jumps to the search box', await page.evaluate(() => document.activeElement?.matches('.lib-head input.search')));
await page.keyboard.type('zzz-nothing');
check('typing filters the list', (await page.locator('.cards .card').count()) === 0);
await page.screenshot({ path: join(OUT, '3-searching.png') });
await page.fill('.lib-head input.search', '');

await page.evaluate(() => document.querySelector('.main')?.scrollTo(0, 900));
await page.waitForTimeout(200);
const top = await page.locator('.lib-head').evaluate((el) => el.getBoundingClientRect().top);
check('the toolbar stays at the top while the list scrolls', top >= -1 && top < 20, String(top));
await page.screenshot({ path: join(OUT, '4-scrolled.png') });

await page.click('.lib-head >> text=Select');
check('Select starts picking', (await page.locator('.select-bar').count()) === 1);
await page.click('.select-bar button:has-text("Cancel")');
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
