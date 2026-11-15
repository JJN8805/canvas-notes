// Right-click menus, Ctrl-drag copy, lock, Tab-to-connect, quick-add letters, the ? sheet, the map and delete-with-undo.
// Run with the dev server up (`npm run dev`):  node scripts/interact-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-interact-check');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const root = join(homedir(), '.cache', 'ms-playwright');
  for (const d of readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse())
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) if (existsSync(join(root, d, sub))) return join(root, d, sub);
}
const results = [];
const check = (name, ok, detail = '') => {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
};
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=All pages');
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');
const count = () => page.locator('.world > .block').count();
const body = page.locator('.viewport');

// 1. right-click empty canvas → add here
await page.mouse.click(500, 300, { button: 'right' });
await page.waitForSelector('.menu');
const m1 = await page.locator('.menu').innerText();
check('right-click on empty canvas offers Add here, Select all and Zoom to fit', /Add here/.test(m1) && /Sticky note/.test(m1) && /Select all/.test(m1) && /Zoom to fit/.test(m1), m1);
await page.screenshot({ path: join(OUT, '1-canvas-menu.png') });
await page.click('.menu :text("Sticky note")');
await page.waitForTimeout(300);
check('"Sticky note" adds one box', (await count()) === 1);
await page.keyboard.press('Escape');
await page.mouse.click(900, 600);

// 2. right-click a box → menu
const box = page.locator('.world > .block').first();
const bb = await box.boundingBox();
await page.mouse.click(bb.x + 100, bb.y + 100, { button: 'right' });
await page.waitForSelector('.menu');
const m2 = await page.locator('.menu').innerText();
check('right-click on a box offers Duplicate, Lock, Layer and Delete', /Duplicate/.test(m2) && /Lock in place/.test(m2) && /Bring to front/.test(m2) && /Delete/.test(m2), m2);
await page.screenshot({ path: join(OUT, '2-box-menu.png') });
await page.click('.menu :text("Lock in place")');
await page.waitForTimeout(250);
check('the box shows a lock badge', (await page.locator('.block.locked .lock-badge').count()) === 1);

// 3. a locked box cannot be dragged or deleted by keyboard
const before = await box.boundingBox();
await page.mouse.move(before.x + 100, before.y + 100);
await page.mouse.down();
await page.mouse.move(before.x + 160, before.y + 120, { steps: 8 });
await page.mouse.up();
const after = await box.boundingBox();
check('a locked box does not move when dragged', Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1, `${before.x},${before.y} -> ${after.x},${after.y}`);
await page.keyboard.press('Delete');
await page.waitForTimeout(250);
check('Delete keeps a locked box and says so', (await count()) === 1 && /locked/i.test(await page.locator('.toast, [role="status"]').allInnerTexts().then((t) => t.join(' '))));
await page.keyboard.press('Control+Shift+L');
await page.waitForTimeout(200);
check('Ctrl+Shift+L unlocks', (await page.locator('.block.locked').count()) === 0);

// 4. Ctrl-drag copies
const b0 = await box.boundingBox();
await page.keyboard.down('Control');
await page.mouse.move(b0.x + 100, b0.y + 100);
await page.mouse.down();
await page.mouse.move(b0.x + 300, b0.y + 40, { steps: 10 });
await page.mouse.up();
await page.keyboard.up('Control');
await page.waitForTimeout(300);
check('Ctrl+drag leaves the original and drags a copy', (await count()) === 2);
const xs = await page.$$eval('.world > .block', (els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
check('the original stayed and the copy moved', Math.abs(xs[0] - b0.x) < 2 && Math.abs(xs[1] - b0.x) >= 200, xs.join(','));

// 5. one undo takes the copy back
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('one undo removes the copy', (await count()) === 1);

// 6. Tab: connected sticky
await page.locator('.world > .block').first().click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Escape');
await page.mouse.click(bb.x + 100, bb.y + 100);
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
check('Tab adds a sticky joined by an arrow', (await count()) === 2 && (await page.locator('.arrow-layer path, .arrow-hit').count()) > 0);
await page.screenshot({ path: join(OUT, '3-tab-branch.png') });
await page.keyboard.press('Escape');
await page.mouse.click(1000, 800);

// 7. quick add letters
await page.mouse.move(800, 500);
await page.keyboard.press('t');
await page.waitForTimeout(250);
check('T adds a text box at the pointer', (await count()) === 3);
await page.keyboard.press('Escape');
await page.mouse.click(1100, 820);
await page.mouse.move(300, 600);
await page.keyboard.press('f');
await page.waitForTimeout(250);
check('F adds a frame', (await page.locator('.world .b-frame').count()) === 1);
await page.mouse.click(1100, 820);

// 8. ? sheet
await page.keyboard.press('?');
await page.waitForSelector('.dialog.shortcuts');
check('? opens the shortcut sheet with groups', /add/i.test(await page.locator('.dialog.shortcuts').innerText()) && /arrange/i.test(await page.locator('.dialog.shortcuts').innerText()));
await page.screenshot({ path: join(OUT, '4-shortcuts.png') });
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.dialog.shortcuts'));
check('Esc closes it', true);

// 9. delete → toast → undo
const nBefore = await count();
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await page.waitForTimeout(300);
const toastText = (await page.locator('.toast, [role="status"]').allInnerTexts()).join(' ');
check('Delete offers Undo in a toast', /deleted/i.test(toastText) && /Undo/.test(toastText), toastText);
await page.screenshot({ path: join(OUT, '5-delete-toast.png') });
await page.click('.toast button:has-text("Undo"), [role="status"] button:has-text("Undo")');
await page.waitForTimeout(300);
check('the toast’s Undo brings everything back', (await count()) === nBefore && nBefore >= 3, String(nBefore));

// 10. the map: hidden while everything is in view, shown when zoomed in past it, and clicking it moves the view
await page.keyboard.press('Escape');
await page.mouse.click(1100, 850);
await page.keyboard.press('Control+1');
await page.waitForTimeout(300);
check('the map is hidden while everything is in view', (await page.locator('.minimap').count()) === 0);
for (let i = 0; i < 5; i++) await page.keyboard.press('Control+=');
await page.waitForTimeout(400);
check('the map appears once part of the page is out of view', (await page.locator('.minimap').count()) === 1);
await page.screenshot({ path: join(OUT, '6-map.png') });
const sc0 = await page.evaluate(() => { const v = document.querySelector('.viewport'); return [v.scrollLeft, v.scrollTop]; });
const mb = await page.locator('.minimap').boundingBox();
await page.mouse.click(mb.x + 6, mb.y + mb.height - 6);
await page.waitForTimeout(300);
const sc1 = await page.evaluate(() => { const v = document.querySelector('.viewport'); return [v.scrollLeft, v.scrollTop]; });
check('clicking the map moves the view', sc0[0] !== sc1[0] || sc0[1] !== sc1[1], `${sc0} -> ${sc1}`);
await page.keyboard.press('m');
await page.waitForTimeout(250);
check('M hides the map', (await page.locator('.minimap').count()) === 0);
await page.keyboard.press('m');

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
