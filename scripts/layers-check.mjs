// What is painted over what (boxes and the drawing): the real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/layers-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-layers-check');
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
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'], });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

// The toolbar has one Note button; a sticky is a note switched to the Sticky style from its bar.
async function addSticky(page) {
  await page.click('.tools .tool:has-text("Note")');
  await page.waitForTimeout(250);
  await page.locator('.world > .block.sel button[aria-label="Note style"]').click();
  await page.click('.menu >> text=Sticky');
  await page.waitForTimeout(250);
  await page.locator('.world > .block.sel .ProseMirror').first().dblclick();
}

await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=All pages');
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');

// two stickies, overlapping a little
for (let i = 0; i < 2; i++) {
  await addSticky(page);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.locator('.ed-body').click({ position: { x: 1000, y: 700 } });
}
check('two stickies were made', (await page.locator('.world > .block').count()) === 2);
const ids = await page.$$eval('.world > .block', (els) => els.map((e) => e.dataset.id));

// a stroke across both
await page.click('.tools .tool:has-text("Draw")');
await page.waitForSelector('.draw-overlay .excalidraw', { timeout: 20000 });
await page.waitForTimeout(800);
await page.locator('[data-testid="toolbar-freedraw"]').evaluate((el) => el.click());
const bb = await page.locator('.world > .block').first().boundingBox();
await page.mouse.move(bb.x - 60, bb.y + 20); await page.mouse.down();
await page.mouse.move(bb.x + 300, bb.y + 150, { steps: 14 }); await page.mouse.move(bb.x + 100, bb.y + 220, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(900);
await page.click('.draw-done');
await page.waitForFunction(() => !document.querySelector('.draw-overlay'));
await page.waitForSelector('.world > .ink');

// where things sit in the paint order: the DOM order of the layers in the world
const stack = () => page.evaluate(() => [...document.querySelectorAll('.world > .block, .world > .ink')].map((e) => (e.classList.contains('ink') ? 'ink' : e.dataset.id)));
const names = (s) => s.map((x) => (x === 'ink' ? 'ink' : x === ids[0] ? 'A' : 'B')).join('');
check('by default the drawing is over every box', names(await stack()).endsWith('ink') && names(await stack()) !== 'ink', names(await stack()));
await page.screenshot({ path: join(OUT, '1-ink-over-everything.png') });

// the Layer menu of a box: "Above the drawing"
const A = page.locator(`.world > .block[data-id="${ids[0]}"]`);
await A.hover({ position: { x: 6, y: 6 } });
await A.locator('.grip').click();
await page.click(`.world > .block[data-id="${ids[0]}"] button[aria-label="Layer"]`);
const menuText = await page.locator('.menu').innerText();
check('the Layer menu offers just front and back, and "Above the drawing"', /Bring to front/.test(menuText) && /Send to back/.test(menuText) && /Above the drawing/.test(menuText) && !/forward|backward/i.test(menuText) && (await page.locator('.menu button, .menu [role="menuitem"]').count()) === 3, menuText);
await page.screenshot({ path: join(OUT, '2-layer-menu.png') });
await page.click('.menu :text("Above the drawing")');
await page.waitForTimeout(300);
const s2 = names(await stack());
check('"Above the drawing" puts that box after the drawing, and only that one', /ink.*A$|ink.*A/.test(s2) && s2.indexOf('ink') < s2.indexOf('A') && s2.indexOf('B') < s2.indexOf('ink'), s2);
await page.screenshot({ path: join(OUT, '3-box-above-drawing.png') });

// it is a tick in the menu now, and undo reverses it
await A.hover({ position: { x: 6, y: 6 } });
await page.click(`.world > .block[data-id="${ids[0]}"] button[aria-label="Layer"]`);
check('the menu shows it ticked', (await page.locator('.menu [role="menuitemcheckbox"][aria-checked="true"], .menu .check, .menu button:has-text("Above the drawing") svg').count()) >= 1);
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('Ctrl+Z puts the drawing back over the box', names(await stack()).endsWith('ink'), names(await stack()));
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(300);
check('Ctrl+Shift+Z puts the box over the drawing again', names(await stack()).indexOf('ink') < names(await stack()).indexOf('A'));

// keyboard: Ctrl+[ and Ctrl+] move the selected box among the boxes it is stacked with (so first take it off the "over the drawing" layer)
await A.hover({ position: { x: 6, y: 6 } });
await page.click(`.world > .block[data-id="${ids[0]}"] button[aria-label="Layer"]`);
await page.click('.menu :text("Above the drawing")');
await page.waitForTimeout(250);
check('un-ticking "Above the drawing" puts the drawing over the box again', names(await stack()).endsWith('ink'), names(await stack()));
await page.locator('.ed-body').click({ position: { x: 1000, y: 120 } });
await A.hover({ position: { x: 6, y: 6 } });
await A.locator('.grip').click();
const order0 = (await stack()).filter((x) => x !== 'ink').map((x) => (x === ids[0] ? 'A' : 'B')).join('');
await page.keyboard.press('Control+BracketLeft');
await page.waitForTimeout(250);
const order1 = (await stack()).filter((x) => x !== 'ink').map((x) => (x === ids[0] ? 'A' : 'B')).join('');
await page.keyboard.press('Control+BracketRight');
await page.waitForTimeout(250);
const order2 = (await stack()).filter((x) => x !== 'ink').map((x) => (x === ids[0] ? 'A' : 'B')).join('');
check('Ctrl+[ sends the box backward, Ctrl+] brings it forward', order0 === 'BA' && order1 === 'AB' && order2 === 'BA', `${order0} ${order1} ${order2}`);
await page.keyboard.press('Control+Shift+BracketLeft');
await page.waitForTimeout(250);
check('Ctrl+Shift+[ sends it to the back', (await stack()).filter((x) => x !== 'ink')[0] === ids[0]);
await page.keyboard.press('Control+Shift+BracketRight');
await page.waitForTimeout(250);
check('Ctrl+Shift+] brings it to the front', (await stack()).filter((x) => x !== 'ink').at(-1) === ids[0]);

// the page menu: the whole drawing behind all the boxes
await page.click('.ed-size');
const pm = await page.locator('.menu').innerText();
check('the page menu has a Drawing section with in front / behind', /Drawing/.test(pm) && /In front of the boxes/.test(pm) && /Behind all the boxes/.test(pm), pm);
await page.click('.menu :text("Behind all the boxes")');
await page.waitForTimeout(300);
check('"Behind all the boxes" puts the drawing first', (await stack())[0] === 'ink');
await page.screenshot({ path: join(OUT, '4-drawing-behind.png') });
await A.hover({ position: { x: 6, y: 6 } });
await A.locator('.grip').click();
await page.click(`.world > .block[data-id="${ids[0]}"] button[aria-label="Layer"]`);
check('with the drawing behind, "Above the drawing" is not offered (it would mean nothing)', (await page.locator('.menu :text("Above the drawing")').count()) === 0);
await page.keyboard.press('Escape');

// draw again: the drawing stays behind
await page.click('.tools .tool:has-text("Draw")');
await page.waitForSelector('.draw-overlay .excalidraw', { timeout: 20000 });
await page.waitForTimeout(600);
await page.locator('[data-testid="toolbar-freedraw"]').evaluate((el) => el.click());
await page.mouse.move(300, 650); await page.mouse.down(); await page.mouse.move(500, 700, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(800);
await page.click('.draw-done');
await page.waitForFunction(() => !document.querySelector('.draw-overlay'));
await page.waitForSelector('.world > .ink');
check('after drawing some more, the drawing is still behind the boxes', (await stack())[0] === 'ink');

// it follows the page into the library and into the export
await page.click('.ed-back');
await page.waitForSelector('.sidebar');
check('the page card in the library paints the drawing first too', await page.evaluate(() => { const m = document.querySelector('.thumb .mini'); return !!m && m.firstElementChild?.classList.contains('ink'); }));
await page.click('.card-title, .pagecard, .page-card >> nth=0').catch(() => {});
await page.waitForSelector('.ed-body');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), (async () => { await page.click('.ed-export'); await page.click('.menu :text("PNG image")'); })()]);
check('the page still exports as a picture', (await dl.suggestedFilename()).endsWith('.png'));
await dl.saveAs(join(OUT, '5-export.png'));

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
