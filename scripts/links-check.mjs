// Links between boxes, frames, pages and cards, and the graph: the real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/links-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-links-check');
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
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
  await page.waitForTimeout(300);
}

await page.goto(URL);
await page.waitForSelector('.sidebar');
async function newPage(title) {
  await page.goto(URL);
  await page.waitForSelector('.sidebar');
  await page.click('.sidebar >> text=All pages');
  await page.click('button:has-text("New page")');
  await page.click('.tpl:has-text("Blank")');
  await page.waitForSelector('.ed-body');
  await page.locator('input[aria-label="Page title"], .ed-title').first().fill(title);
}
// Page "Target" with a sticky; page "Source" with a sticky that links to Target's sticky
await newPage('Target');
await addSticky(page);
await page.waitForTimeout(300);
await page.keyboard.type('the target note');
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
await newPage('Source');
await addSticky(page);
await page.waitForTimeout(300);
await page.keyboard.type('start here');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const box = page.locator('.world > .block').first();
await box.hover({ force: true });
await box.locator('button[aria-label="Links"]').click({ force: true });
await page.waitForSelector('.link-dialog');
await page.fill('.link-dialog input[type=search]', 'Target');
await page.click('.link-dialog li:has-text("Target") >> text=A box…');
await page.click('.link-dialog .ld-name:has-text("the target note")');
check('the link shows in the dialog', (await page.locator('.link-dialog [aria-label="Current links"] li').count()) === 1);
await page.screenshot({ path: join(OUT, 'dialog.png') });
await page.keyboard.press('Escape');
await page.click('.link-dialog .btn.primary').catch(() => {});
await page.waitForFunction(() => !document.querySelector('.link-dialog'));
check('the box shows a link badge', (await page.locator('.world > .block .link-badge').count()) === 1);

// follow it
await page.locator('.world > .block .link-badge').first().click();
await page.click('.menu >> text=Target › Sticky');
await page.waitForFunction(() => location.hash.includes('/page/') && document.querySelector('.world > .block.sel'));
check('following opens Target with the box selected', (await page.locator('.world > .block.sel').count()) === 1);
await page.waitForSelector('.ed-backlinks');
check('Target says it is linked from Source', (await page.locator('.ed-backlinks:has-text("Linked from 1")').count()) === 1, await page.locator('.ed-backlinks').allInnerTexts().then((t) => t.join('/') + ' @' + page.url()));

// survives a reload (saved)
await page.waitForTimeout(1500);
await page.reload();
await page.evaluate(() => { location.hash = ''; });
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=All pages');
await page.click('.card-title:text-is("Source")');
await page.waitForSelector('.world > .block');
check('the link survives a reload', (await page.locator('.world > .block .link-badge').count()) === 1);

// graph
await page.keyboard.press('Escape');
await page.keyboard.press('Control+p');
await page.waitForSelector('.palette');
await page.fill('.palette input', 'graph view');
await page.click('.palette-row:has-text("graph view")');
await page.waitForSelector('.graph-svg');
check('graph has both pages and a box-link edge', (await page.locator('.graph-node').count()) >= 2 && (await page.locator('.graph-edge.box').count()) === 1);
await page.screenshot({ path: join(OUT, 'graph.png') });
await page.uncheck('.graph-tools >> text=Box links');
check('turning box links off removes the edge', (await page.locator('.graph-edge').count()) === 0);
await page.check('.graph-tools >> text=Box links');
await page.fill('.graph-tools input[type=search]', 'Target');
check('searching dims the others', (await page.locator('.graph-node.off').count()) >= 1);

// the graph: filter, drag, click a line
await page.fill('.graph-tools input[type=search]', '');
await page.screenshot({ path: join(OUT, 'graph2.png') });
const before = await page.locator('.graph-node circle').first().getAttribute('cx');
const nb = await page.locator('.graph-node').first().boundingBox();
await page.mouse.move(nb.x + nb.width / 2, nb.y + 6);
await page.mouse.down();
await page.mouse.move(nb.x + 120, nb.y + 90, { steps: 8 });
await page.mouse.up();
const after = await page.locator('.graph-node circle').first().getAttribute('cx');
check('dragging a dot moves it and does not open the page', before !== after && (await page.locator('.graph-svg').count()) === 1, `${before} -> ${after}`);
await page.locator('.graph-edge-hit').first().dispatchEvent('click');
check('clicking a line says which boxes it joins', (await page.locator('.graph-edge-info li').count()) === 1 && (await page.locator('.graph-edge-info').innerText()).includes('Sticky'));
await page.selectOption('select[aria-label="Only this tag"]', { index: 0 });
check('the group and tag filters are there', (await page.locator('select[aria-label="Only this group"]').count()) === 1 && (await page.locator('select[aria-label="Only this tag"]').count()) === 1);

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
