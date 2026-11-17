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
await page.waitForSelector('.tree3d-canvas');
await page.waitForTimeout(1500);
const screen = () => page.evaluate(() => document.querySelector('.tree3d-canvas').__screen());
let sc = await screen();
check('graph has both pages and a box-link line', sc.nodes.filter((n) => n.kind === 'page').length >= 2 && sc.edges.filter((e) => e.kind === 'box').length === 1, JSON.stringify(sc.edges));
await page.screenshot({ path: join(OUT, 'graph.png') });
await page.uncheck('.graph-panel >> text=Box links');
await page.waitForTimeout(300);
check('turning box links off removes the line', (await screen()).edges.length === 0);
await page.check('.graph-panel >> text=Box links');
await page.waitForTimeout(300);
await page.fill('.graph-tools input[type=search]', 'Target');
await page.waitForTimeout(200);
check('searching dims the others', (await page.locator('.tl-row.off').count()) >= 1);
await page.fill('.graph-tools input[type=search]', '');

// the graph: drag a dot, click a line
await page.screenshot({ path: join(OUT, 'graph2.png') });
for (let i = 0; i < 40 && (await screen()).alpha > 0.002; i++) await page.waitForTimeout(250);
sc = await screen();
const first = sc.nodes.find((n) => n.kind === 'page');
const moved = { x: first.x + 90, y: first.y + 60 };
await page.mouse.move(first.x, first.y);
await page.mouse.down();
await page.mouse.move(moved.x, moved.y, { steps: 8 });
const held = (await screen()).nodes.find((n) => n.id === first.id);
await page.mouse.up();
check('dragging a dot moves it and does not open the page', Math.hypot(held.x - moved.x, held.y - moved.y) < 25 && (await page.locator('.graphview').count()) === 1, `${held.x},${held.y} vs ${moved.x},${moved.y}`);
for (let i = 0; i < 40 && (await screen()).alpha > 0.002; i++) await page.waitForTimeout(250);
const line = (await screen()).edges.find((e) => e.kind === 'box');
await page.mouse.click(line.x, line.y);
await page.waitForSelector('.graph-edge-info', { timeout: 3000 }).catch(() => {});
check('clicking a line says which boxes it joins', (await page.locator('.graph-edge-info li').count()) === 1 && (await page.locator('.graph-edge-info').innerText()).includes('Sticky'));
await page.selectOption('select[aria-label="Only this tag"]', { index: 0 });
check('the group and tag filters are there', (await page.locator('select[aria-label="Only this group"]').count()) === 1 && (await page.locator('select[aria-label="Only this tag"]').count()) === 1);

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
