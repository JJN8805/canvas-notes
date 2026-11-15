// Cards: folders, sections and nested sections (no gallery or board), drag to file, persistence after a reload, page groups kept apart.
// Run with the dev server up (`npm run dev`):  node scripts/card-folders-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-folders-check');
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
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf');
const texts = async () => (await page.locator('.cf-main').innerText());

check('there is no Gallery or Board switch any more', (await page.locator('button:has-text("Gallery"), button:has-text("Board")').count()) === 0);
check('the folder tree is there, with All cards', (await page.locator('.cf-tree').innerText()).includes('All cards'));
await page.screenshot({ path: join(OUT, '1-empty.png') });

const newFolder = async (name, viaMain = true) => {
  await page.click(viaMain ? '.cf-main button:has-text("New folder"), .cf-main button:has-text("New section")' : '.cf-new');
  await page.waitForSelector('.dialog input');
  await page.fill('.dialog input', name);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
};
// a folder, opened straight away; then a section inside it; then a section inside that
await newFolder('Plants');
check('a new folder opens, with a breadcrumb', /Cards\s*\/\s*Plants/.test(await page.locator('.cf-crumbs').innerText()));
check('inside a folder the button says "New section"', (await page.locator('.cf-main .controls').innerText()).includes('New section'));
await newFolder('Indoor');
check('the section shows as a section with its heading, inside its folder', (await page.locator('.section').count()) === 1 && /Indoor/.test(await page.locator('.section-head').innerText()));
await page.click('.section-name');
await newFolder('Ferns');
await page.click('.section-name');
check('sections nest: Cards / Plants / Indoor / Ferns', /Cards\s*\/\s*Plants\s*\/\s*Indoor\s*\/\s*Ferns/.test(await page.locator('.cf-crumbs').innerText()), await page.locator('.cf-crumbs').innerText());
await page.screenshot({ path: join(OUT, '2-nested.png') });

// a card made here lands here
await page.click('.cf-main button:has-text("New card")');
await page.waitForSelector('.cd-label');
await page.fill('.cd-label', 'Boston fern');
const sel = await page.locator('select[aria-label^="Folder or section"]').inputValue();
check('the card’s Folder picker shows where it is, by full path', (await page.locator('select[aria-label^="Folder or section"] option:checked').innerText()) === 'Plants / Indoor / Ferns', await page.locator('select[aria-label^="Folder or section"] option:checked').innerText());
await page.screenshot({ path: join(OUT, '3-card.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
if (await page.locator('.cd-label').count()) await page.click('.dialog button:has-text("Close"), .cd-actions button:has-text("Done"), .scrim');
await page.waitForTimeout(200);
check('the card is in the section', (await page.locator('.cf-main .ctile').count()) === 1);

// the tree counts cards inside, however deep
const treeText = await page.locator('.cf-tree').innerText();
check('the tree counts the card in every folder above it', (treeText.match(/\b1\b/g) ?? []).length >= 3, treeText.replace(/\n/g, ' | '));

// a second folder, and a card dragged onto it in the tree
await page.click('.cf-root');
await newFolder('Recipes', false);
await page.click('.cf-root');
await page.waitForTimeout(200);
await page.click('.cf-tree >> text=Ferns');
await page.waitForTimeout(200);
await page.locator('.cf-card').first().dragTo(page.locator('.cf-tree .cf-row', { hasText: 'Recipes' }));
await page.waitForTimeout(400);
check('dragging a card onto a folder in the tree moves it there', (await page.locator('.cf-main .ctile').count()) === 0);
await page.click('.cf-tree >> text=Recipes');
check('and it is in Recipes now', (await page.locator('.cf-main .ctile').count()) === 1);

// a section dragged onto another folder moves with everything in it; a folder cannot go into its own section
await page.click('.cf-root');
await page.locator('.section-head', { hasText: 'Plants' }).dragTo(page.locator('.cf-tree .cf-row', { hasText: 'Recipes' }));
await page.waitForTimeout(400);
check('a whole folder can be dragged inside another: it is now a section of Recipes, not a folder of its own', (await page.locator('.section.level-0 > .section-head', { hasText: 'Plants' }).count()) === 0 && (await page.locator('.section:has(> .section-head:has-text("Recipes")) .section-head:has-text("Plants")').count()) === 1);
await page.screenshot({ path: join(OUT, '4-moved.png') });

// the right-click-free menu: delete a section, its cards and sections move up
await page.click('.cf-tree >> text=Recipes');
await page.waitForTimeout(200);
await page.locator('.cf-main .section-head', { hasText: 'Plants' }).locator('button[aria-label^="Menu for"]').click();
const menu = await page.locator('.menu').innerText();
check('a folder menu offers edit, new section, colour, move and delete', /New section/.test(menu) && /Edit name and description/.test(menu) && /Move into/.test(menu) && /Delete folder|Delete section/.test(menu), menu);
await page.screenshot({ path: join(OUT, '5-menu.png') });
await page.keyboard.press('Escape');

// everything survives a reload (the browser database)
await page.reload();
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf');
const after = await page.locator('.cf-tree').innerText();
check('after a reload the folders and sections are all still there', /Recipes/.test(after) && /Plants/.test(after) && /Indoor/.test(after) && /Ferns/.test(after), after.replace(/\n/g, ' | '));

// card folders are not page groups
await page.click('.sidebar >> text=Groups');
await page.waitForTimeout(400);
const groupsText = await page.locator('.main').innerText();
check('none of the card folders show up among the page groups', !/Recipes|Plants|Indoor|Ferns/.test(groupsText), groupsText.slice(0, 200));

// the page group picker of a page never lists them either
await page.click('.sidebar >> text=All pages');
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');
const opts = (await page.locator('.ed-group option').allInnerTexts()).join('|');
check('a page’s group picker does not list card folders', !/Recipes|Plants|Indoor|Ferns/.test(opts), opts);
await page.click('.ed-back');

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
