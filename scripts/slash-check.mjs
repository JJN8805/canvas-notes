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

/* "/" typed into an empty text box: the choice replaces that box */
await page.keyboard.press('Escape');
await page.mouse.click(900, 620);
const beforeInline = await count();
await page.mouse.dblclick(900, 330);
await page.waitForTimeout(400);
check('double-click makes a text box with the cursor in it', (await count()) === beforeInline + 1 && (await page.evaluate(() => document.activeElement?.isContentEditable === true)));
await page.keyboard.press('/');
await page.waitForSelector('.slash');
check('"/" in an empty text box opens the menu (and types nothing)', (await page.evaluate(() => document.querySelector('.slash-input') === document.activeElement)));
await page.keyboard.type('table');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('choosing Table replaces the empty box (the count is unchanged, there is a table)', (await count()) === beforeInline + 1 && (await page.locator('.world .block.b-table').count()) >= 1);

/* "/" at the start of a box with words: it turns into another kind and keeps them */
await page.keyboard.press('Escape');
await page.mouse.click(300, 600);
const beforeTurn = await count();
await page.mouse.dblclick(300, 640);
await page.waitForTimeout(400);
await page.keyboard.type('Milk');
await page.keyboard.press('Enter');
await page.keyboard.type('Bread');
await page.keyboard.press('Control+Home');
await page.keyboard.press('/');
await page.waitForSelector('.slash');
check('"/" at the start of a box with words opens "Turn into" (no table or frame offered)', (await page.locator('.slash-item').count()) === 4 && (await page.getAttribute('.slash-input', 'placeholder')).startsWith('Turn into'));
await page.keyboard.type('todo');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
check('it became a list with the words as items, in the same place', (await count()) === beforeTurn + 1 && (await page.locator('.world .block.b-checklist').filter({ hasText: 'Milk' }).filter({ hasText: 'Bread' }).count()) === 1);
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('one undo gives the note back', (await page.locator('.world .block.b-checklist').filter({ hasText: 'Milk' }).count()) === 0);
await page.keyboard.press('Escape');

/* focus mode */
await page.keyboard.press('Escape');
await page.mouse.click(900, 660);
await page.keyboard.press('Control+Shift+f');
await page.waitForTimeout(200);
check('Ctrl+Shift+F hides the header, tools and zoom', (await page.locator('.ed-head:visible').count()) === 0 && (await page.locator('.tools:visible').count()) === 0 && (await page.locator('.focus-exit').count()) === 1);
await page.click('.focus-exit');
check('the button brings them back', (await page.locator('.ed-head:visible').count()) === 1);

/* menu rows show their key at the right edge */
await page.mouse.click(1100, 200, { button: 'right' });
await page.waitForSelector('.menu');
check('the right-click menu shows keys apart from the names', (await page.locator('.menu .menu-key').count()) >= 4);
await page.keyboard.press('Escape');

/* favorites and recent */
await page.click('.ed-star');
check('the star is pressed', (await page.getAttribute('.ed-star', 'aria-pressed')) === 'true');
await page.evaluate(() => (location.hash = '#/'));
await page.waitForSelector('.sidebar');
check('a starred page is listed under Favorites in the sidebar', (await page.locator('.side-section[aria-label="Favorites"] .nav-item:has-text("Plan")').count()) === 1);
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette');
check('the quick switcher lists the favorite first, marked as one', /Favorite/.test(await page.locator('.palette-row').first().innerText()));
await page.keyboard.press('Escape');
await page.click('.side-section[aria-label="Favorites"] .nav-item:has-text("Plan")');
await page.waitForSelector('.world');
await page.click('.ed-star');
await page.evaluate(() => (location.hash = '#/'));
await page.waitForSelector('.sidebar');
check('un-starring takes it out, and it shows under Recent', (await page.locator('.side-section[aria-label="Favorites"]').count()) === 0 && (await page.locator('.side-section[aria-label="Recent"] .nav-item:has-text("Plan")').count()) === 1);
await page.screenshot({ path: join(OUT, 'sidebar.png') });
await page.click('.card:has-text("Plan")');
await page.waitForSelector('.world');

/* page icon */
await page.click('.ed-icon');
await page.waitForSelector('.dialog input');
await page.fill('.dialog input', '📘');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('the icon shows in the header', (await page.locator('.ed-icon.has').innerText()).includes('📘'));
await page.waitForFunction(() => /Saved/.test(document.querySelector('.status')?.textContent ?? ''));
await page.reload();
await page.waitForSelector('.world');
check('and it is still there after a reload (browser storage)', (await page.locator('.ed-icon.has').count()) === 1);
await page.evaluate(() => (location.hash = '#/'));
await page.waitForSelector('.sidebar');
check('the page card and the sidebar show it', (await page.locator('.card-title .page-icon').first().innerText()) === '📘' && (await page.locator('.side-section[aria-label="Recent"] .page-icon').count()) === 1);
await page.click('.card:has-text("Plan")');
await page.waitForSelector('.world');
await page.click('.ed-icon');
await page.waitForSelector('.dialog input');
await page.fill('.dialog input', '<b>');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('an unsafe icon removes it instead of being stored', (await page.locator('.ed-icon.has').count()) === 0);

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
