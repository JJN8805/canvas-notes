// Editing a section's name and description in place, from the menu, cancelling, persistence.
// Run with the dev server up (`npm run dev`):  node scripts/section-edit-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-section-edit-check');
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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
const page = await ctx.newPage();
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
await page.click('.cf-main button:has-text("New section")'); await ask('Asia');
await page.waitForTimeout(300);
const heads = () => page.$$eval('.section-head .section-name', (els) => els.map((e) => e.textContent));
check('two sections to start with', (await heads()).join(',') === 'Europe,Asia');

// no description yet: a quiet "add a description" is offered
check('a section with no description offers to add one', (await page.locator('.section:has(> .section-head:has-text("Europe")) .section-adddesc').count()) === 1);

// edit in place with the pencil
await page.click('button[aria-label="Edit Europe"]');
const form = page.locator('.section:has(> .section-head:has-text("Europe")) .fe');
check('the pencil opens a form in the section, with the name ready to type over', (await form.count()) === 1 && (await form.locator('input').inputValue()) === 'Europe' && (await page.evaluate(() => document.activeElement?.tagName)) === 'INPUT');
check('the form calls it a section, not a folder, because it is inside Trips', /Section name/.test(await form.innerText()) && /What is this section for/.test(await form.locator('textarea').getAttribute('placeholder') ?? ''), await form.innerText());
await page.screenshot({ path: join(OUT, '1-form.png') });
await form.locator('input').fill('Europe trip');
await form.locator('textarea').fill('Spring tour.\nFlights booked, hotels still to do.');
await form.locator('button:has-text("Save")').click();
await page.waitForTimeout(250);
check('saving renames the section in its heading', (await heads()).join(',') === 'Europe trip,Asia');
const desc = await page.locator('.section-desc').first().innerText();
check('and shows the description under it, with its line break', /Spring tour\./.test(desc) && /Flights booked/.test(desc) && desc.includes('\n'), JSON.stringify(desc));
check('the form is gone', (await page.locator('.fe').count()) === 0);
await page.screenshot({ path: join(OUT, '2-described.png') });
check('the tree shows the new name too', /Europe trip/.test(await page.locator('.cf-tree').innerText()));

// it is saved (saves are batched for a moment, so give it that moment)
await page.waitForTimeout(1500);
await page.reload(); await page.waitForSelector('.sidebar'); await page.click('.sidebar >> text=Cards'); await page.waitForSelector('.cf');
await page.click('.cf-tree .cf-go:has-text("Trips")');
check('name and description are still there after a reload', (await heads()).includes('Europe trip') && /Flights booked/.test(await page.locator('.section-desc').first().innerText()));

// Esc cancels, an empty name keeps the old one
await page.click('button[aria-label="Edit Europe trip"]');
await page.locator('.fe input').fill('Something else');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Esc throws the changes away', (await page.locator('.fe').count()) === 0 && (await heads()).includes('Europe trip'));
await page.click('button[aria-label="Edit Europe trip"]');
await page.locator('.fe input').fill('   ');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('an empty name is not accepted: the old name stays', (await heads()).includes('Europe trip') && (await page.locator('.fe').count()) === 0);

// clicking the description edits it; clearing it removes it
await page.click('.section-desc');
check('clicking the description opens the form', (await page.locator('.fe').count()) === 1);
await page.locator('.fe textarea').fill('');
await page.locator('.fe textarea').press('Control+Enter');
await page.waitForTimeout(250);
check('Ctrl+Enter saves, and an empty description is removed', (await page.locator('.section-desc').count()) === 0 && (await page.locator('.section:has(> .section-head:has-text("Europe trip")) .section-adddesc').count()) === 1);

// from the tree's menu: opens that section on its own, ready to edit
await page.locator('.cf-tree .cf-row', { hasText: 'Asia' }).hover();
await page.locator('.cf-tree button[aria-label="Menu for Asia"]').click();
const menu = await page.locator('.menu').innerText();
check('the folder menu has "Edit name and description…"', /Edit name and description/.test(menu), menu);
await page.click('.menu :text("Edit name and description")');
await page.waitForTimeout(300);
check('from the tree it opens that section and edits its details under the title', /Trips\s*\/\s*Asia/.test(await page.locator('.cf-crumbs').innerText()) && (await page.locator('.cf-main > .fe').count()) === 1);
await page.locator('.cf-main > .fe textarea').fill('Rail passes and visas.');
await page.locator('.cf-main > .fe button:has-text("Save")').click();
await page.waitForTimeout(250);
check('the description of the opened section shows under its title', /Rail passes and visas\./.test(await page.locator('.cf-desc').innerText()));
await page.screenshot({ path: join(OUT, '3-opened.png') });
await page.click('.cf-desc');
check('and clicking it edits it', (await page.locator('.cf-main > .fe').count()) === 1);
await page.keyboard.press('Escape');

// back up: the folder shows both sections, Asia with its description
await page.click('.cf-tree .cf-go:has-text("Trips")');
check('in the folder, Asia’s description sits in its section', /Rail passes/.test(await page.locator('.section:has(> .section-head:has-text("Asia"))').innerText()));

// editing a rolled-up section opens it
await page.locator('.section-head:has-text("Asia") .section-twist').click();
await page.waitForTimeout(150);
check('a rolled-up section hides its description', (await page.locator('.section-desc').filter({ hasText: 'Rail passes' }).count()) === 0);
await page.click('button[aria-label="Edit Asia"]');
check('editing it opens it up', (await page.locator('.section:has(> .section-head:has-text("Asia")) .fe').count()) === 1);
await page.keyboard.press('Escape');

// a long description wraps and does not push the page sideways
await page.click('button[aria-label="Edit Asia"]');
await page.locator('.fe textarea').fill('A very long description without any breaks at all '.repeat(40));
await page.locator('.fe textarea').press('Control+Enter');
await page.waitForTimeout(250);
const over = await page.evaluate(() => { const m = document.querySelector('.cf-main'); return m.scrollWidth - m.clientWidth; });
check('a long description wraps inside its section', over <= 1, String(over));
await page.screenshot({ path: join(OUT, '4-long.png') });

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
