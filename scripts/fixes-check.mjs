// The audit fixes: toast owner, frame copy, Tab undo, Tidy vs lock, settings tabs, Journal badge, mind map page size.
// Run with the dev server up (`npm run dev`):  node scripts/fixes-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-fixes-check');
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

// settings tabs on one row
await page.click('.side-settings');
await page.waitForSelector('.set-tabs');
const tops = await page.$$eval('.set-tab', (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
check('all ten Settings tabs sit on one row', tops.length === 10 && new Set(tops).size === 1, tops.join(','));
const cut = await page.evaluate(() => { const bar = document.querySelector('.set-tabs').getBoundingClientRect(); return [...document.querySelectorAll('.set-tab')].filter((t) => t.getBoundingClientRect().right > bar.right + 0.5).map((t) => t.textContent.trim()); });
check('and every one is fully visible (none cut off at the edge)', cut.length === 0, cut.join(','));
await page.screenshot({ path: join(OUT, '1-settings-tabs.png') });
await page.click('.dialog.settings button:has-text("Done")');

// a blank page with a sticky
await page.click('.sidebar >> text=All pages');
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');
await page.mouse.click(1000, 780);
await page.mouse.move(500, 300);
await page.keyboard.press('s');
await page.waitForTimeout(250);
await page.keyboard.press('Escape');
const sticky = page.locator('.world > .block').first();
let bb = await sticky.boundingBox();

// Tab branches in ONE undo step
await page.mouse.click(bb.x + 100, bb.y + 100);
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
check('Tab made a second box and an arrow', (await page.locator('.world > .block').count()) === 2 && (await page.locator('.arrow-hit').count()) === 1);
await page.keyboard.press('Escape');
await page.mouse.click(1100, 800);
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('ONE undo removes both the box and the arrow', (await page.locator('.world > .block').count()) === 1 && (await page.locator('.arrow-hit').count()) === 0, `${await page.locator('.world > .block').count()} boxes, ${await page.locator('.arrow-hit').count()} arrows`);

// a delete toast does not outlive the page
bb = await sticky.boundingBox();
await page.mouse.click(bb.x + 100, bb.y + 100);
await page.keyboard.press('Escape');
await page.mouse.click(bb.x + 100, bb.y + 100);
await page.keyboard.press('Delete');
await page.waitForTimeout(300);
const t1 = (await page.locator('.toast').allInnerTexts()).join('|');
check('deleting shows the Undo toast', /deleted/i.test(t1) && /Undo/.test(t1), t1);
await page.click('.ed-back');
await page.waitForSelector('.sidebar');
await page.waitForTimeout(300);
check('leaving the page removes that toast', (await page.locator('.toast').count()) === 0, (await page.locator('.toast').allInnerTexts()).join('|'));

// Ctrl+D on a frame copies what is in it
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');
await page.mouse.click(1100, 800);
await page.mouse.move(400, 250);
await page.keyboard.press('f');
await page.waitForTimeout(250);
await page.mouse.click(1100, 800);
const fr = page.locator('.world .b-frame').first();
const fb = await fr.boundingBox();
await page.mouse.move(fb.x + 80, fb.y + 120);
await page.keyboard.press('s');
await page.waitForTimeout(250);
await page.keyboard.press('Escape');
await page.mouse.click(1100, 800);
const before = await page.locator('.world > .block').count();
// select just the frame: a small marquee over its top-left corner (its header is full of controls, and the sticky is further in)
await page.mouse.move(fb.x - 25, fb.y - 25);
await page.mouse.down();
await page.mouse.move(fb.x + 12, fb.y + 12, { steps: 5 });
await page.mouse.up();
await page.keyboard.press('Control+d');
await page.waitForTimeout(300);
check('Ctrl+D on a frame copies the frame and what is in it', before === 2 && (await page.locator('.world > .block').count()) === 4, `${before} -> ${await page.locator('.world > .block').count()}`);

// Journal: Today flag next to the date, delete at the far right; toolbar tells you it scrolls
await page.click('.ed-back');
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Journal');
await page.waitForSelector('.book-heading');
await page.waitForTimeout(600);
const geo = await page.evaluate(() => {
  const r = (s) => document.querySelector(s)?.getBoundingClientRect();
  const dt = r('.book-heading .dt'), flag = r('.today-flag'), del = r('.book-delete'), head = r('.book-heading');
  return { dtRight: dt && dt.right, flagLeft: flag && flag.left, flagRight: flag && flag.right, delLeft: del && del.left, headRight: head && head.right, flagMid: flag && (flag.top + flag.bottom) / 2, dtMid: dt && (dt.top + dt.bottom) / 2 };
});
check('Today sits right after the date', geo.flagLeft - geo.dtRight < 40 && geo.flagLeft >= geo.dtRight, JSON.stringify(geo));
check('the delete button is at the far right', !geo.delLeft || geo.headRight - (geo.delLeft + 30) < 40, JSON.stringify(geo));
check('Today is vertically centred on the date', Math.abs(geo.flagMid - geo.dtMid) < 8, JSON.stringify(geo));
const scrolls = await page.evaluate(() => { const t = document.querySelector('.book .tools'); return t ? { scrolls: t.scrollHeight > t.clientHeight, bg: getComputedStyle(t).backgroundImage.includes('gradient') } : null; });
check('the book’s tool column shows a scroll shadow when it scrolls', !!scrolls && (!scrolls.scrolls || scrolls.bg), JSON.stringify(scrolls));
await page.screenshot({ path: join(OUT, '2-journal.png') });

// mind map is infinite, as its text says
await page.click('.sidebar >> text=All pages');
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Mind map")');
await page.waitForSelector('.ed-body');
await page.waitForTimeout(500);
check('a page from the Mind map template has no edges', (await page.locator('.sheet').count()) === 0);
await page.screenshot({ path: join(OUT, '3-mindmap.png') });

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
