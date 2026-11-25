// Information architecture: the grouped sidebar, the New menu, "Or start with" tiles, the Studio name; laptop and phone.
// Run with the dev server up (`npm run dev`):  node scripts/ia-check.mjs   (screenshots in /tmp/canvas-ia-check)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-ia-check');
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
const errors = [];
const open = async (opts) => {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font|Fullscreen/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
  page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));
  await page.goto(URL);
  await page.waitForSelector('.sidebar, .phone-tabs', { timeout: 30000 });
  await page.waitForTimeout(600);
  return { ctx, page };
};

{
  const { ctx, page } = await open({ viewport: { width: 1400, height: 900 } });
  const heads = await page.locator('.sidebar .side-head').allInnerTexts();
  check('the sidebar is grouped: Library, Organize', heads.map((h) => h.toLowerCase()).includes('library') && heads.map((h) => h.toLowerCase()).includes('organize'), heads.join(', '));
  const nav = await page.locator('.sidebar .nav-item .lbl').allInnerTexts();
  check('Studio replaces the second "Workspace"', nav.includes('Studio') && !nav.includes('Workspace'), nav.join(', '));
  check('Templates, Archive and Trash sit apart under Manage', (await page.locator('.side-manage .nav-item').count()) >= 2);
  check('no zero counts clutter the list', (await page.locator('.sidebar .nav-item .cnt').allInnerTexts()).every((t) => t.trim() !== '0'));
  check('a New button is the first thing after the workspace', (await page.locator('.side-new').count()) === 1);
  await page.click('.side-new');
  await page.waitForSelector('.menu');
  const items = await page.locator('.menu .menu-item').allInnerTexts();
  check('the New menu lists page, card, document, spreadsheet, presentation and script', ['Page', 'Card', 'Document', 'Spreadsheet', 'Presentation', 'Script'].every((l) => items.some((t) => t.trim().startsWith(l))), items.join('|'));
  await page.screenshot({ path: join(OUT, 'new-menu.png') });
  await page.click('.menu-item:has-text("Script")');
  await page.waitForSelector('.sc-screen');
  check('one click makes a script from the New menu', true);
  await page.goto(URL + '#/');
  await page.waitForSelector('.sidebar');
  check('the Studio entry opens the hub with four kinds', await (async () => { await page.click('.sidebar >> text=Studio'); await page.waitForSelector('.office-hub'); return (await page.locator('.office-col').count()) === 4; })());
  await ctx.close();
}
{
  const { ctx, page } = await open({ viewport: { width: 1400, height: 900 } });
  await page.evaluate(() => indexedDB.deleteDatabase('canvas-notes'));
  await ctx.close();
}
{
  const { ctx, page } = await open({ viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  check('the phone has New as the middle tab, not the sidebar button', (await page.locator('.phone-new').count()) === 1 && !(await page.locator('.side-new').isVisible().catch(() => false)));
  await page.locator('.phone-new').tap();
  await page.waitForSelector('.menu');
  const items = await page.locator('.menu .menu-item').allInnerTexts();
  check('on the phone it opens the same New menu', items.some((t) => t.trim().startsWith('Script')) && items.some((t) => t.trim().startsWith('Page')), items.join('|'));
  await page.screenshot({ path: join(OUT, 'phone-new.png') });
  await ctx.close();
}
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
