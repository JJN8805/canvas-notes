// Closing and reopening the sidebar and the card folders: buttons, shortcuts, memory, overlap, phone layout.
// Run with the dev server up (`npm run dev`):  node scripts/sidebars-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-sidebars-check');
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
const vis = (sel) => page.locator(sel).first().isVisible();
const box = (sel) => page.locator(sel).first().boundingBox();

check('the sidebar is open at first, with a hide button', (await vis('.sidebar')) && (await page.locator('button[aria-label="Hide sidebar"]').count()) === 1);
const mainBefore = await box('.main');
await page.screenshot({ path: join(OUT, '1-open.png') });
await page.click('button[aria-label="Hide sidebar"]');
await page.waitForTimeout(200);
check('hiding it removes the sidebar and offers a Show button', !(await vis('.sidebar')) && (await vis('button[aria-label="Show sidebar"]')));
const mainAfter = await box('.main');
check('the page uses the room it freed', mainAfter.width > mainBefore.width + 200, `${mainBefore.width} -> ${mainAfter.width}`);
await page.screenshot({ path: join(OUT, '2-closed.png') });
const t = await page.locator('.main h1, .main .empty h2').first().boundingBox();
const open = await box('button[aria-label="Show sidebar"]');
check('the Show button does not sit on top of the page title', !t || t.x >= open.x + open.width || t.y >= open.y + open.height || t.y + t.height <= open.y, JSON.stringify({ t, open }));
await page.click('button[aria-label="Show sidebar"]');
check('Show brings it back', await vis('.sidebar'));

await page.keyboard.press('Control+Backslash');
await page.waitForTimeout(150);
check('Ctrl+\\ hides it', !(await vis('.sidebar')));
await page.keyboard.press('Control+Backslash');
await page.waitForTimeout(150);
check('and shows it again', await vis('.sidebar'));

// remembered
await page.click('button[aria-label="Hide sidebar"]');
await page.reload();
await page.waitForSelector('.library');
check('a closed sidebar is still closed after a reload', !(await vis('.sidebar')) && (await vis('button[aria-label="Show sidebar"]')));
await page.click('button[aria-label="Show sidebar"]');

// the card folders
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf');
check('the card folders have their own hide button', (await vis('.cf-tree')) && (await page.locator('button[aria-label="Hide folders"]').count()) === 1);
await page.click('button[aria-label="Hide folders"]');
await page.waitForTimeout(200);
check('hiding them leaves the cards, with a Show folders button beside the breadcrumb', !(await vis('.cf-tree')) && (await vis('button[aria-label="Show folders"]')) && (await vis('.cf-main')));
const cm = await box('.cf-main');
check('the cards screen fills the width the folders had', cm.width > 1000, String(cm.width));
await page.screenshot({ path: join(OUT, '3-folders-closed.png') });
await page.keyboard.press('Control+Shift+Backslash');
await page.waitForTimeout(150);
check('Ctrl+Shift+\\ shows the folders again', await vis('.cf-tree'));
await page.keyboard.press('Control+Shift+Backslash');
await page.waitForTimeout(150);
check('and hides them', !(await vis('.cf-tree')));

// both closed: the two Show buttons must not overlap
await page.click('button[aria-label="Hide sidebar"]');
await page.waitForTimeout(200);
const a = await box('button[aria-label="Show sidebar"]');
const b = await box('button[aria-label="Show folders"]');
const overlap = !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
check('with both closed the two Show buttons do not overlap', !overlap, JSON.stringify({ a, b }));
await page.screenshot({ path: join(OUT, '4-both-closed.png') });
await page.reload();
await page.waitForSelector('.library');
await page.click('button[aria-label="Show sidebar"]');
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf');
check('the card folders stay closed after a reload too', !(await vis('.cf-tree')) && (await vis('.cf-main')));
await page.click('button[aria-label="Hide sidebar"]');
await page.reload();
await page.waitForSelector('.library');
check('and the sidebar as well', !(await vis('.sidebar')));
await page.click('button[aria-label="Show sidebar"]');
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf');
await page.click('button[aria-label="Show folders"]');
check('and both come back', (await vis('.sidebar')) && (await vis('.cf-tree')));

// the shortcut sheet lists them
await page.keyboard.press('Control+Backslash');
await page.keyboard.press('Control+Backslash');
await page.mouse.click(900, 500);
await page.keyboard.press('?');
await page.waitForSelector('.dialog.shortcuts');
const sheet = await page.locator('.dialog.shortcuts').innerText();
check('the ? sheet lists both shortcuts', /Show or hide the sidebar/.test(sheet) && /Show or hide the card folders/.test(sheet));
await page.keyboard.press('Escape');

// a phone-sized window always keeps its navigation bar, even if the sidebar was closed
await page.click('button[aria-label="Hide sidebar"]');
await page.setViewportSize({ width: 600, height: 800 });
await page.waitForTimeout(250);
check('on a narrow screen the navigation is still there when the sidebar is closed', (await vis('.sidebar')) && !(await vis('button[aria-label="Show sidebar"]')));
await page.screenshot({ path: join(OUT, '5-narrow.png') });

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
