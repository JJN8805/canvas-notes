// Hand tool, rebinding the one-letter keys in Settings, and the lock badge on frames.
// Run with the dev server up (`npm run dev`):  node scripts/keys-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-keys-check');
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
// 1. rebind in Settings: S -> N
await page.click('.side-settings');
await page.click('[role="tab"]:has-text("About"), button:has-text("About")');
await page.waitForSelector('.quickkeys');
await page.screenshot({ path: join(OUT, '1-quickkeys.png') });
await page.click('.quickkey-btn[aria-label^="Sticky note"]');
await page.keyboard.press('t');
check('a letter another action has is refused, with the reason', /Text box/.test(await page.locator('.quickkeys-error').innerText()));
await page.keyboard.press('n');
check('pressing a free letter rebinds it', (await page.locator('.quickkey-btn[aria-label^="Sticky note"]').innerText()) === 'N');
await page.screenshot({ path: join(OUT, '2-rebound.png') });
check('Reset appears once something differs', (await page.locator('button:has-text("Reset to the usual keys")').count()) === 1);
await page.keyboard.press('Escape');
await page.locator('.scrim button:has-text("Close"), .dialog button:has-text("Close"), .dialog button:has-text("Done")').first().click().catch(async () => page.keyboard.press('Escape'));
await page.waitForTimeout(300);

await page.click('.sidebar >> text=All pages');
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');
const count = () => page.locator('.world > .block').count();
await page.mouse.click(1000, 700);
await page.mouse.move(600, 400);
await page.keyboard.press('s');
await page.waitForTimeout(200);
check('the old letter no longer adds a sticky', (await count()) === 0);
await page.keyboard.press('n');
await page.waitForTimeout(250);
check('the new letter does', (await count()) === 1);
await page.keyboard.press('Escape');
await page.mouse.click(1100, 800);

// 2. hand tool
const box = page.locator('.world > .block').first();
const b0 = await box.boundingBox();
const pos = () => box.evaluate((el) => el.style.left + ',' + el.style.top);
const p0 = await pos();
await page.keyboard.press('h');
await page.waitForSelector('.hand-badge');
check('H turns the hand tool on and shows it', (await page.locator('.viewport.hand-on').count()) === 1);
await page.screenshot({ path: join(OUT, '3-hand.png') });
await page.mouse.move(b0.x + 100, b0.y + 100);
await page.mouse.down();
await page.mouse.move(b0.x + 250, b0.y + 160, { steps: 8 });
await page.mouse.up();
const b1 = await box.boundingBox();
const sel = await page.locator('.block.sel').count();
check('dragging with the hand tool does not move the box or select it', sel === 0 && (await pos()) === p0, `${p0} -> ${await pos()} selected ${sel}`);
const v0 = await page.evaluate(() => ({ x: document.querySelector('.viewport').scrollLeft, y: document.querySelector('.viewport').scrollTop }));
await page.keyboard.press('Space');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Esc leaves the hand tool', (await page.locator('.hand-badge').count()) === 0);
await page.mouse.move(b1.x + 100, b1.y + 100);
await page.mouse.down();
await page.mouse.move(b1.x + 180, b1.y + 150, { steps: 6 });
await page.mouse.up();
const b2 = await box.boundingBox();
check('afterwards a drag moves the box again', Math.abs(b2.x - b1.x) > 30, `${b1.x} -> ${b2.x}`);

// 3. a locked frame shows a badge
await page.keyboard.press('Escape');
await page.mouse.click(1100, 800);
await page.mouse.move(300, 500);
await page.keyboard.press('f');
await page.waitForTimeout(250);
await page.keyboard.press('Control+Shift+L');
await page.waitForTimeout(250);
check('a locked frame shows the lock badge', (await page.locator('.b-frame.locked .lock-badge').count()) === 1);
await page.screenshot({ path: join(OUT, '4-frame-lock.png') });

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
