// The note: one box that switches between Text, Sticky and Code. The real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/note-check.mjs
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

await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=All pages');
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');

const tools = await page.$$eval('.tools .tool', (els) => els.map((e) => e.textContent.trim()));
check('the toolbar has one Note button and no separate Text, Sticky or Code', tools.includes('Note') && !['Text', 'Sticky', 'Code'].some((t) => tools.includes(t)), tools.join(','));

await page.click('.tools .tool:has-text("Note")');
await page.waitForTimeout(300);
await page.keyboard.type('Hello note');
await page.keyboard.press('Control+b');
await page.keyboard.type(' bold');
const box = page.locator('.world > .block.sel');
const styleBtn = box.locator('button[aria-label="Note style"]');
check('a new note is a Text note', (await styleBtn.innerText()).startsWith('Text'));
check('the Fill button shows for text', (await box.locator('button[aria-label="Add background"]').count()) === 1);

// text -> sticky
await styleBtn.click();
await page.click('.menu >> text=Sticky');
await page.waitForTimeout(300);
check('it becomes a sticky (own look, fixed size, no Fill)', (await page.locator('.world > .block.b-sticky').count()) === 1 && (await page.locator('.world > .block.sel button[aria-label="Add background"]').count()) === 0);
check('the words are kept', (await page.locator('.world > .block.b-sticky').innerText()).includes('Hello note bold'));

// sticky -> code: bold would be lost, so it asks first
await page.locator('.world > .block.sel button[aria-label="Note style"]').click();
await page.click('.menu >> text=Code');
await page.waitForSelector('.dialog:has-text("Make this a code note")');
await page.click('.dialog button:has-text("Make code")');
await page.waitForSelector('.world > .block.b-code textarea');
check('it becomes code, plain text', (await page.locator('.world > .block.b-code textarea').inputValue()) === 'Hello note bold');

// undo goes back to the sticky with its formatting
await page.keyboard.press('Escape');
await page.locator('.ed-body').click({ position: { x: 900, y: 700 } });
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('Ctrl+Z brings back the formatted sticky', (await page.locator('.world > .block.b-sticky strong').count()) === 1);

// survives a reload
await page.waitForTimeout(1500);
await page.reload();
await page.waitForSelector('.world > .block');
check('the note keeps its style after a reload', (await page.locator('.world > .block.b-sticky').count()) === 1);

// Alt+N cycles the style of the selected note: sticky -> code -> text
await page.locator('.world > .block.b-sticky').click({ position: { x: 5, y: 5 } }).catch(() => {});
await page.keyboard.press('Escape');
await page.locator('.world > .block.b-sticky .grab').click({ force: true });
await page.keyboard.press('Alt+n');
await page.waitForSelector('.dialog:has-text("Make this a code note")');
await page.click('.dialog button:has-text("Make code")');
await page.waitForSelector('.world > .block.b-code');
check('Alt+N moves the selected note on to the next style', true);
await page.keyboard.press('Alt+n');
await page.waitForSelector('.world > .block.b-text');
check('and round again to text', (await page.locator('.world > .block.b-text').count()) === 1);

// [[ opens the page picker
await page.goto(URL + '#/');
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=All pages');
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');
await page.locator('input[aria-label="Page title"], .ed-title').first().fill('Picker target');
await page.goto(URL + '#/');
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=All pages');
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');
await page.click('.tools .tool:has-text("Note")');
await page.waitForTimeout(300);
await page.keyboard.type('see [[Pick');
await page.waitForSelector('.page-suggest');
check('typing [[ offers pages', (await page.locator('.page-suggest li').first().innerText()) === 'Picker target');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('Enter writes the link and closes the picker', (await page.locator('.world > .block.sel').innerText()).includes('[[Picker target]]') && (await page.locator('.page-suggest').count()) === 0);

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
