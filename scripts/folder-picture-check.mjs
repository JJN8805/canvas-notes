// A card folder or section with its own picture: add one from the menu, see it in the heading and as a banner, change and remove it.
// Run with the dev server up (`npm run dev`):  node scripts/folder-picture-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-folder-picture-check');
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
// Two small pictures (SVG is a picture the app accepts as it is).
const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="${fill}"/><circle cx="120" cy="60" r="40" fill="white"/></svg>`;
writeFileSync(join(OUT, 'a.svg'), svg('#c0392b'));
writeFileSync(join(OUT, 'b.svg'), svg('#2980b9'));

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf');
const ask = async (name) => { await page.waitForSelector('.dialog input'); await page.fill('.dialog input', name); await page.keyboard.press('Enter'); await page.waitForTimeout(250); };
await page.click('.cf-new'); await ask('Trips');
await page.click('.cf-main button:has-text("New section")'); await ask('Europe');
await page.waitForTimeout(300);
const head = page.locator('.section-head', { hasText: 'Europe' });
check('a new section has no picture yet', (await page.locator('.folder-pic').count()) === 0);

const pick = async (file) => {
  const chooser = page.waitForEvent('filechooser');
  await page.click('.menu-item:has-text("picture")');
  await (await chooser).setFiles(join(OUT, file));
  await page.waitForTimeout(700);
};
await head.locator('button[aria-label^="Menu for"]').click();
await pick('a.svg');
check('its menu adds a picture: a small one shows in the heading', (await head.locator('.folder-pic.thumb img').count()) === 1);
check('and a banner across the top of the section', (await page.locator('.section:has(> .section-head:has-text("Europe")) .folder-pic.banner img').count()) === 1);
await page.evaluate(() => { document.querySelector('.cf-main').scrollTop = 0; });
await page.screenshot({ path: join(OUT, '1-picture.png') });

await head.locator('button[aria-label^="Menu for"]').click();
check('the menu now offers Change and Remove', (await page.locator('.menu-item:has-text("Change the section")').count()) === 1 && (await page.locator('.menu-item:has-text("Remove the picture")').count()) === 1);
await pick('b.svg');
check('changing it keeps one picture', (await page.locator('.folder-pic.banner').count()) === 1);

// it survives a reload (stored, not just on screen)
await page.reload();
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf');
await page.locator('.cf >> text=Trips').first().click();
await page.waitForTimeout(700);
check('the picture is still there after a reload', (await page.locator('.folder-pic.banner img').count()) === 1);
const natural = await page.locator('.folder-pic.banner img').evaluate((i) => i.complete && i.naturalWidth > 0);
check('and it really loads', natural);

await page.locator('.section-head', { hasText: 'Europe' }).locator('button[aria-label^="Menu for"]').click();
await page.click('.menu-item:has-text("Remove the picture")');
await page.waitForTimeout(300);
check('Remove takes it away', (await page.locator('.folder-pic').count()) === 0);

// the edit form has a picture row too
await page.locator('.section-head', { hasText: 'Europe' }).locator('button[aria-label^="Edit"]').click();
await page.waitForSelector('.fe');
check('the edit form offers Add a picture', (await page.locator('.fe button:has-text("Add a picture")').count()) === 1);
await page.screenshot({ path: join(OUT, '2-edit.png') });
await page.keyboard.press('Escape');

check('no console errors', errors.length === 0, errors.join(' | '));
console.log('screenshots in', OUT);
await browser.close();
process.exit(failed ? 1 : 0);
