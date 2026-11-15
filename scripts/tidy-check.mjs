// "Tidy this page": the real app in headless Chromium. Run with the dev server up (`npm run dev`):  node scripts/tidy-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-tidy-check');
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

// three boxes made apart, then dragged so that they overlap and are nearly (not quite) lined up
const spots = [[410, 300, 'one'], [410, 560, 'two'], [760, 560, 'three']];
for (const [x, y, t] of spots) {
  await page.mouse.dblclick(x, y);
  await page.waitForSelector('.ProseMirror-focused');
  await page.keyboard.type(t);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}
const dragTo = async (index, wantX, wantY) => {
  const blk = page.locator('.world > .block').nth(index);
  await blk.hover();
  const bb = await blk.boundingBox();
  const gb = await blk.locator('.grip').boundingBox();
  const fx = gb.x + gb.width / 2, fy = gb.y + gb.height / 2;
  await page.mouse.move(fx, fy); await page.mouse.down();
  await page.mouse.move(fx + (wantX - bb.x), fy + (wantY - bb.y), { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
};
const topLeft = async (text) => page.locator('.world > .block', { hasText: text }).first().boundingBox();
const one = await topLeft('one');
await dragTo(1, one.x + 22, one.y + 14);
await dragTo(2, one.x + 6, one.y + 22);
const rects = () => page.$$eval('.world > .block', (els) => els.map((e) => ({ id: e.dataset.id, x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight })));
const overlapCount = (rs) => { let n = 0; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (Math.min(rs[i].x + rs[i].w, rs[j].x + rs[j].w) - Math.max(rs[i].x, rs[j].x) > 4 && Math.min(rs[i].y + rs[i].h, rs[j].y + rs[j].h) - Math.max(rs[i].y, rs[j].y) > 4) n++; return n; };
const before = await rects();
check('three boxes were made', before.length === 3, JSON.stringify(before));
check('and they overlap, to begin with', overlapCount(before) > 0, JSON.stringify(before));
await page.screenshot({ path: join(OUT, '1-messy.png') });

// the menu entry opens the proposal
await page.click('.ed-size');
await page.click('.menu :text("Tidy layout…")');
await page.waitForSelector('.dialog.tidy');
const dlg = await page.locator('.dialog.tidy').innerText();
check('the proposal shows the page now and after, and says what would change', (await page.locator('.dialog.tidy .thumb').count()) === 2 && /Now/.test(dlg) && /After tidying/.test(dlg) && /(Lined up|Moved \d+ overlapping)/.test(dlg), dlg);
check('it says nothing changes until Apply', /Nothing changes until you press Apply/.test(dlg));
check('the page is untouched while the proposal is on show', JSON.stringify(await rects()) === JSON.stringify(before));
await page.screenshot({ path: join(OUT, '2-proposal.png') });

// Cancel leaves everything
await page.click('.dialog.tidy button:has-text("Cancel")');
await page.waitForFunction(() => !document.querySelector('.dialog.tidy'));
check('Cancel changes nothing', JSON.stringify(await rects()) === JSON.stringify(before));

// Escape closes it too
await page.keyboard.press('Control+p');
await page.fill('.palette input', 'tidy this page');
check('the command palette has "Tidy this page…"', (await page.locator('.palette-list li:has-text("Tidy this page")').count()) === 1);
await page.keyboard.press('Enter');
await page.waitForSelector('.dialog.tidy');
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.dialog.tidy'));
check('Escape closes the proposal and changes nothing', JSON.stringify(await rects()) === JSON.stringify(before));

// Apply
await page.click('.ed-size');
await page.click('.menu :text("Tidy layout…")');
await page.waitForSelector('.dialog.tidy');
await page.click('.dialog.tidy button:has-text("Apply")');
await page.waitForFunction(() => !document.querySelector('.dialog.tidy'));
await page.waitForTimeout(300);
const after = await rects();
check('Apply separates the boxes', overlapCount(after) === 0, JSON.stringify(after));
check('...and every box is still inside the page', await page.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(); return [...document.querySelectorAll('.world > .block')].every((e) => { const r = e.getBoundingClientRect(); return r.x >= s.x - 2 && r.right <= s.right + 2 && r.y >= s.y - 2 && r.bottom <= s.bottom + 2; }); }));
check('...and the text of the boxes is kept', (await page.locator('.world > .block .ProseMirror').allInnerTexts()).map((t) => t.trim()).sort().join() === 'one,three,two');
await page.screenshot({ path: join(OUT, '3-applied.png') });

// one undo restores everything
await page.locator('.ed-body').click({ position: { x: 900, y: 600 } });
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('one undo puts every box back where it was', JSON.stringify(await rects()) === JSON.stringify(before), JSON.stringify(await rects()));

// a tidy page says so
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(300);
await page.click('.ed-size');
await page.click('.menu :text("Tidy layout…")');
await page.waitForSelector('.dialog.tidy');
check('a page that is already tidy says so', /already tidy/.test(await page.locator('.dialog.tidy').innerText()) && (await page.locator('.dialog.tidy button:has-text("Apply")').count()) === 0);
await page.screenshot({ path: join(OUT, '4-already-tidy.png') });
await page.keyboard.press('Escape');

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
