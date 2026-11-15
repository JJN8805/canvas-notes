// Sections laid out like frames: heading, its cards below, then the next section; nesting, roll up, drop, reorder.
// Run with the dev server up (`npm run dev`):  node scripts/sections-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-sections-check');
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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 640 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf');

const ask = async (name) => { await page.waitForSelector('.dialog input'); await page.fill('.dialog input', name); await page.keyboard.press('Enter'); await page.waitForTimeout(250); };
const newFolder = async (name) => { await page.click('.cf-main button:has-text("New folder"), .cf-main button:has-text("New section")'); await ask(name); };
const addCardTo = async (where, label) => {
  await page.locator('.section-head', { hasText: where }).locator('button[aria-label^="Add a card to"]').click();
  await page.waitForSelector('.cd-label');
  await page.fill('.cd-label', label);
  await page.click('.card-detail button:has-text("Done")');
  await page.waitForTimeout(200);
};

// Trips › Europe › France, and Trips › Asia
await page.click('.cf-new'); await ask('Trips');           // opens Trips
await newFolder('Europe');
await newFolder('Asia');
await page.locator('.section-head', { hasText: 'Europe' }).locator('button[aria-label^="Menu for"]').click();
await page.click('.menu :text("New section")'); await ask('France');
await page.waitForTimeout(300);
await addCardTo('France', 'Eiffel');
await addCardTo('France', 'Louvre');
await addCardTo('Europe', 'Alps');
await addCardTo('Asia', 'Tokyo');
await page.evaluate(() => { document.querySelector('.cf-main').scrollTop = 0; });
await page.waitForTimeout(200);
await page.screenshot({ path: join(OUT, '1-sections.png') });

const box = (sel) => page.locator(sel).first().boundingBox();
const heads = await page.$$eval('.section-head', (els) => els.map((e) => e.querySelector('.section-name').textContent));
check('the sections come one after another: Europe, then France inside it, then Asia', heads.join(',') === 'Europe,France,Asia', heads.join(','));
check('France is inside Europe (nested), Asia is beside it', (await page.locator('.section:has(> .section-head:has-text("Europe")) .section:has(> .section-head:has-text("France"))').count()) === 1 && (await page.locator('.section:has(> .section-head:has-text("Europe")) .section:has(> .section-head:has-text("Asia"))').count()) === 0);
const europeHead = await box('.section-head:has-text("Europe")');
const alps = await box('.cf-card:has-text("Alps")');
const franceHead = await box('.section:has(> .section-head:has-text("France")) > .section-head');
const louvre = await box('.cf-card:has-text("Louvre")');
const asiaHead = await box('.section-head:has-text("Asia")');
const tokyo = await box('.cf-card:has-text("Tokyo")');
check('a section’s heading is on top and its own cards are below it', alps.y > europeHead.y + europeHead.height - 2 && louvre.y > franceHead.y + franceHead.height - 2 && tokyo.y > asiaHead.y + asiaHead.height - 2);
check('Europe’s own card comes before its France section', alps.y < franceHead.y);
check('when France’s cards are finished, the next section (Asia) starts below them', asiaHead.y > louvre.y + louvre.height - 2, `${asiaHead.y} vs ${louvre.y + louvre.height}`);
check('each heading says how many cards it holds, counting the ones inside', /3 cards/.test(await page.locator('.section-head:has-text("Europe")').innerText()) && /2 cards/.test(await page.locator('.section-head:has-text("France")').innerText()) && /1 card\b/.test(await page.locator('.section-head:has-text("Asia")').innerText()), await page.locator('.section-head').allInnerTexts().then((t) => t.join(' | ')));

// the heading of the section you are in stays on screen while you scroll through it
await page.evaluate(() => { const m = document.querySelector('.cf-main'); m.scrollTop = 320; });
await page.waitForTimeout(200);
const mainTop = (await box('.cf-main')).y;
const stuck = await box('.section-head:has-text("Europe")');
check('the top-level heading sticks to the top while its cards scroll past', stuck.y <= mainTop + 6, `${stuck.y} vs ${mainTop}`);
await page.evaluate(() => { document.querySelector('.cf-main').scrollTop = 0; });

// roll a section up: its cards (and sections) hide and the next one moves up
const asiaBefore = (await box('.section-head:has-text("Asia")')).y;
await page.locator('.section-head:has-text("Europe") .section-twist').click();
await page.waitForTimeout(200);
check('rolling Europe up hides its cards and its France section', (await page.locator('.cf-card:has-text("Alps")').count()) === 0 && (await page.locator('.section-head:has-text("France")').count()) === 0);
check('and Asia moves up to take its place', (await box('.section-head:has-text("Asia")')).y < asiaBefore - 50);
await page.screenshot({ path: join(OUT, '2-rolled-up.png') });
await page.reload(); await page.waitForSelector('.sidebar'); await page.click('.sidebar >> text=Cards'); await page.waitForSelector('.cf');
await page.click('.cf-tree .cf-go:has-text("Trips")');
check('a rolled-up section stays rolled up after a reload', (await page.locator('.cf-card:has-text("Alps")').count()) === 0 && (await page.locator('.section-head:has-text("Europe") .section-twist[aria-expanded="false"]').count()) === 1);
await page.locator('.section-head:has-text("Europe") .section-twist').click();
await page.waitForTimeout(200);

// drop a card on a section (anywhere on it) to file it there
await page.locator('.cf-card:has-text("Tokyo")').dragTo(page.locator('.section:has(> .section-head:has-text("France")) > .section-body'));
await page.waitForTimeout(400);
check('dropping Tokyo on the France section files it there', (await page.locator('.section:has(> .section-head:has-text("France")) .cf-card').count()) === 3 && (await page.locator('.section:has(> .section-head:has-text("Asia")) .cf-card').count()) === 0);
check('and Asia is now empty, with a hint', /No cards here yet/.test(await page.locator('.section:has(> .section-head:has-text("Asia"))').innerText()));

// reorder: move Asia up so it comes before Europe
await page.locator('.section-head:has-text("Asia") button[aria-label^="Menu for"]').click();
const menu = await page.locator('.menu').innerText();
check('the menu offers Move up for Asia (and no Move down, it is last)', /Move up/.test(menu) && !/Move down/.test(menu), menu);
await page.click('.menu :text("Move up")');
await page.waitForTimeout(300);
check('Asia now comes before Europe', (await page.$$eval('.section-head', (els) => els.map((e) => e.querySelector('.section-name').textContent))).join(',') === 'Asia,Europe,France');
await page.screenshot({ path: join(OUT, '3-reordered.png') });

// clicking a heading's name opens that section on its own
await page.click('.section-head:has-text("France") .section-name');
check('clicking a heading opens that section, with its breadcrumb', /Trips\s*\/\s*Europe\s*\/\s*France/.test(await page.locator('.cf-crumbs').innerText()));
check('and its own cards show right under the title', (await page.locator('.cf-main .ctile').count()) === 3);

// the top: folders as sections, cards that are not in a folder first
await page.click('.cf-root');
await page.click('.cf-main button:has-text("New card")');
await page.waitForSelector('.cd-label');
await page.fill('.cd-label', 'Loose one');
await page.click('.card-detail button:has-text("Done")');
await page.waitForTimeout(250);
const rootHeadings = await page.locator('.cf-heading').allInnerTexts();
check('at the top, loose cards come first and the folders follow as sections', /Not in a folder/i.test(rootHeadings[0] ?? '') && (await page.locator('.section.level-0').count()) === 1, rootHeadings.join('|'));
await page.screenshot({ path: join(OUT, '4-root.png') });

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
