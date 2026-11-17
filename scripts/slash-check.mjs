// The "/" insert menu and the quieter page header: the real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/slash-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-slash-check');
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


const count = () => page.locator('.world .block').count();
const before = await count();
await page.mouse.move(700, 500);
await page.keyboard.press('/');
await page.waitForSelector('.slash');
check('"/" opens the insert menu with every box type', (await page.locator('.slash-item').count()) === 6);
check('the filter field has the focus', await page.evaluate(() => document.activeElement?.classList.contains('slash-input')));
await page.keyboard.type('todo');
check('typing filters the list (to-do finds the list box)', (await page.locator('.slash-item').count()) === 1 && /To-do/.test(await page.locator('.slash-item').innerText()));
await page.screenshot({ path: join(OUT, 'slash.png') });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('Enter adds it to the page and closes the menu', (await count()) === before + 1 && (await page.locator('.slash').count()) === 0);
await page.keyboard.press('Escape');
await page.mouse.click(1000, 700);
await page.keyboard.press('/');
await page.waitForSelector('.slash');
await page.keyboard.type('zzz');
check('no match says so', (await page.locator('.slash-none').count()) === 1);
await page.keyboard.press('Escape');
check('Escape closes it and adds nothing', (await page.locator('.slash').count()) === 0 && (await count()) === before + 1);
await page.mouse.click(1000, 700);
await page.keyboard.press('/');
await page.waitForSelector('.slash');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('arrow keys move through the list and Enter picks (two down = the list box)', (await count()) === before + 2);

/* the header keeps the title readable */
await page.keyboard.press('Escape');
const title = await page.locator('.ed-title').evaluate((el) => ({ w: el.clientWidth, sw: el.scrollWidth }));
check('the page title is not cut off', title.sw <= title.w + 1, JSON.stringify(title));
check('header buttons still have names when their labels are hidden', await page.evaluate(() => [...document.querySelectorAll('.ed-head .btn')].every((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().length > 0)));
await page.screenshot({ path: join(OUT, 'header.png') });
check('no console errors', errors.length === 0, errors.join(' | '));
console.log('screenshots in', OUT);
await browser.close();
process.exit(failed ? 1 : 0);
