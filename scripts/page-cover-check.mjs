// Cards: folders, sections and nested sections (no gallery or board), drag to file, persistence after a reload, page groups kept apart.
// Run with the dev server up (`npm run dev`):  node scripts/page-cover-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-cover-check');
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

const svg = (color, label) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${color}"/><circle cx="320" cy="240" r="120" fill="white" opacity="0.6"/><text x="320" y="256" font-size="56" text-anchor="middle" fill="black">${label}</text></svg>`);
await page.goto(URL);
await page.waitForSelector('.sidebar');
// a page with something on it, so it has a miniature
await page.click('.sidebar >> text=All pages');
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');
await page.fill('.ed-title', 'Trip plan');
await page.mouse.click(1000, 700);
await page.mouse.move(500, 300);
await page.keyboard.press('s');
await page.waitForTimeout(300);
await page.keyboard.type('Pack the bags');
await page.waitForTimeout(800);
await page.click('.ed-back');
await page.waitForSelector('.card');
check('the card shows the usual miniature', (await page.locator('.card .mini').count()) === 1 && (await page.locator('.card .thumb-cover').count()) === 0);

const menu = async () => { await page.locator('.card .card-menu').click(); return page.locator('.menu').innerText(); };
let m = await menu();
check('its menu offers "Cover image…", and no remove option yet', /Cover image…/.test(m) && !/Remove cover image/.test(m) && !/Change cover image/.test(m), m);
await page.screenshot({ path: join(OUT, '1-menu.png') });
const chooser = page.waitForEvent('filechooser');
await page.click('.menu :text("Cover image…")');
await (await chooser).setFiles({ name: 'cover.svg', mimeType: 'image/svg+xml', buffer: svg('#0d9488', 'Cover') });
await page.waitForSelector('.card .thumb-cover img', { timeout: 10000 });
check('the card now shows the picture instead of the miniature', (await page.locator('.card .mini').count()) === 0 && (await page.locator('.card .thumb-cover img').count()) === 1);
const tb = await page.locator('.card .thumb').boundingBox();
const ib = await page.locator('.card .thumb-cover img').boundingBox();
check('the picture fills the whole thumbnail area', Math.abs(tb.width - ib.width) < 1 && Math.abs(tb.height - ib.height) <= 1.5 && Math.abs(tb.width / tb.height - 4 / 3) < 0.02, JSON.stringify({ tb, ib }));
check('it says so, with an Undo', /Cover set/.test((await page.locator('.toast').allInnerTexts()).join(' ')) && (await page.locator('.toast button:has-text("Undo")').count()) === 1);
await page.screenshot({ path: join(OUT, '2-cover.png') });

m = await menu();
check('the menu now offers to change or remove it', /Change cover image…/.test(m) && /Remove cover image/.test(m), m);
await page.keyboard.press('Escape');

// Undo from the toast takes it off again
await page.click('.toast button:has-text("Undo")');
await page.waitForTimeout(300);
check('Undo takes the cover off', (await page.locator('.card .thumb-cover').count()) === 0 && (await page.locator('.card .mini').count()) === 1);

// set again, and it survives a reload
const chooser2 = page.waitForEvent('filechooser');
await page.locator('.card .card-menu').click();
await page.click('.menu :text("Cover image…")');
await (await chooser2).setFiles({ name: 'cover2.svg', mimeType: 'image/svg+xml', buffer: svg('#e11d48', 'Two') });
await page.waitForSelector('.card .thumb-cover img', { timeout: 10000 });
await page.waitForTimeout(1500); // saves are batched for a moment
await page.reload();
await page.waitForSelector('.card');
await page.waitForSelector('.card .thumb-cover img', { timeout: 10000 });
check('the cover is still there after a reload', (await page.locator('.card .thumb-cover img').count()) === 1);
const loaded = await page.locator('.card .thumb-cover img').evaluate((img) => img.complete && img.naturalWidth > 0);
check('and its picture really loads', loaded);

// changing it replaces it
const chooser3 = page.waitForEvent('filechooser');
await page.locator('.card .card-menu').click();
await page.click('.menu :text("Change cover image…")');
await (await chooser3).setFiles({ name: 'cover3.svg', mimeType: 'image/svg+xml', buffer: svg('#2563eb', 'Three') });
await page.waitForTimeout(800);
const srcs = await page.locator('.card .thumb-cover img').getAttribute('src');
check('changing it shows the new picture on the same card', (await page.locator('.card').count()) === 1 && !!srcs);
await page.screenshot({ path: join(OUT, '3-changed.png') });

// the cover is for the library only: the page itself is unchanged
await page.click('.card');
await page.waitForSelector('.ed-body');
await page.waitForTimeout(500);
check('the page itself has no extra box from the cover', (await page.locator('.world > .block').count()) === 1);
await page.click('.ed-back');
await page.waitForSelector('.card');

// remove it
await page.locator('.card .card-menu').click();
await page.click('.menu :text("Remove cover image")');
await page.waitForTimeout(300);
check('Remove cover image brings the miniature back', (await page.locator('.card .thumb-cover').count()) === 0 && (await page.locator('.card .mini').count()) === 1);

// something that is not a picture is refused with a reason
const chooser4 = page.waitForEvent('filechooser');
await page.locator('.card .card-menu').click();
await page.click('.menu :text("Cover image…")');
await (await chooser4).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
await page.waitForTimeout(500);
check('a file that is not a picture is refused, and nothing changes', /couldn’t be set/.test((await page.locator('.toast').allInnerTexts()).join(' ')) && (await page.locator('.card .thumb-cover').count()) === 0);

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
