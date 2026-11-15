// Align, spread and zoom-to-selection: the real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/arrange-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-arrange-check');
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


const mk = async (n, at) => {
  for (let i = 0; i < n; i++) {
    await addSticky(page);
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await page.locator('.ed-body').click({ position: { x: at[i][0], y: at[i][1] } });
  }
};
await mk(3, [[300, 200], [650, 420], [1000, 300]]);
check('three stickies', (await page.locator('.world > .block').count()) === 3);
const tops = () => page.$$eval('.world > .block', (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
const lefts = () => page.$$eval('.world > .block', (els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
await page.keyboard.press('Control+a');
await page.waitForSelector('.multi-bar');
await page.screenshot({ path: join(OUT, '1-selected.png') });
await page.click('.multi-bar >> text=Align');
check('Align menu lists edges, centres and spread', /Left/.test(await page.locator('.menu').innerText()) && /Spread across/.test(await page.locator('.menu').innerText()));
await page.screenshot({ path: join(OUT, '2-align-menu.png') });
await page.click('.menu :text("Top")');
await page.waitForTimeout(300);
const t = await tops();
check('Top aligns every box', new Set(t).size === 1, t.join(','));
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('one undo restores the layout', new Set(await tops()).size > 1);
await page.keyboard.press('Alt+a');
await page.waitForTimeout(300);
check('Alt+A aligns left by keyboard', new Set(await lefts()).size === 1, (await lefts()).join(','));
await page.keyboard.press('Control+z');
await page.keyboard.press('Alt+Shift+H');
await page.waitForTimeout(300);
const l = await lefts();
const w = await page.$$eval('.world > .block', (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
const order = l.map((x, i) => [x, w[i]]).sort((a, b) => a[0] - b[0]);
check('Alt+Shift+H spreads with equal gaps', Math.abs((order[1][0] - order[0][0] - order[0][1]) - (order[2][0] - order[1][0] - order[1][1])) <= 1, JSON.stringify(order));
await page.locator('.world > .block').first().click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Control+-'); await page.keyboard.press('Control+-'); await page.keyboard.press('Control+-');
await page.waitForTimeout(300);
const z0 = await page.evaluate(() => document.querySelector('.world')?.style.transform ?? getComputedStyle(document.querySelector('.world')).transform);
await page.keyboard.press('Shift+Digit2');
await page.waitForTimeout(400);
const z1 = await page.evaluate(() => document.querySelector('.world')?.style.transform ?? getComputedStyle(document.querySelector('.world')).transform);
await page.screenshot({ path: join(OUT, '3-after-zoom-selection.png') });
check('Shift+2 zooms back in on the selection', z0 !== z1 && /scale\(1\)/.test(z1), z0 + ' -> ' + z1);
check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
