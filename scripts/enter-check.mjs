// Enter does what the dialog's main button does (Done, Apply, Create): the real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/enter-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
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
const gone = (sel) => page.waitForFunction((s) => !document.querySelector(s), sel, { timeout: 4000 }).then(() => true, () => false);

await page.goto(URL);
await page.waitForSelector('.sidebar');

/* ---- a new card ---- */
await page.click('.sidebar >> text=Cards');
await page.click('button:has-text("New card")');
await page.waitForSelector('.card-detail');
await page.keyboard.type('Enter closes me');
await page.keyboard.press('Enter');
check('Enter in a new card\'s label does what Done does', await gone('.card-detail'));
check('and the card is kept with its label', (await page.locator('.ctile-label:text-is("Enter closes me")').count()) === 1);

/* ---- the tag field keeps Enter for adding a tag ---- */
await page.click('.ctile-label:text-is("Enter closes me")');
await page.waitForSelector('.card-detail');
await page.fill('input[aria-label="Add a tag to this card"]', 'garden');
await page.keyboard.press('Enter');
check('Enter in the tag field adds the tag and leaves the card open', (await page.locator('.card-detail').count()) === 1 && (await page.locator('.card-detail >> text=garden').count()) >= 1);

/* ---- the details are a text box: Enter is a new line, Ctrl+Enter is Done ---- */
await page.locator('.card-detail .cd-body .ProseMirror').click();
await page.keyboard.type('line one');
await page.keyboard.press('Enter');
await page.keyboard.type('line two');
check('Enter in the details makes a new line, not Done', (await page.locator('.card-detail').count()) === 1 && (await page.locator('.card-detail .cd-body').innerText()).includes('line two'));
await page.keyboard.press('Control+Enter');
check('Ctrl+Enter in the details is Done', await gone('.card-detail'));

/* ---- another new card with Enter straight away ---- */
await page.click('button:has-text("New card")');
await page.waitForSelector('.card-detail');
await page.keyboard.press('Enter');
check('Enter on a brand-new empty card closes it too', await gone('.card-detail'));

/* ---- the links dialog ---- */
await page.goto(URL + '#/');
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=All pages');
await page.click('text=Open an example page');
await page.waitForSelector('.world > .block');
const box = page.locator('.world > .block').first();
await box.hover();
await box.locator('button[aria-label="Links"]').click();
await page.waitForSelector('.link-dialog');
await page.keyboard.press('Enter');
check('Enter in the empty links dialog is Done', await gone('.link-dialog'));

/* ---- a plain "ask" dialog (new group) is a form ---- */
await page.goto(URL + '#/');
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Groups');
await page.click('button:has-text("New group")');
await page.waitForSelector('.dialog input');
await page.keyboard.type('Enter group');
await page.keyboard.press('Enter');
check('Enter in the new-group box creates the group', await gone('.scrim') && (await page.locator('text=Enter group').count()) >= 1);

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
