// Settings → General: version details, system, library counts, diagnostics and what's new.
// Run with the dev server up (`npm run dev`):  node scripts/general-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-general-check');
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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

await page.goto(URL);
await page.waitForSelector('.sidebar');
const { readFileSync } = await import('node:fs');
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
check('the sidebar footer names the version', (await page.locator('.side-ver').innerText()).includes(pkg.version));
await page.click('.side-settings');
await page.waitForSelector('.about-head');
check('Settings opens on General', (await page.locator('[role="tab"][aria-selected="true"]').innerText()).trim() === 'General');
const text = await page.locator('.set-body').innerText();
check('General shows the version, build, commit and system', text.includes(`Version ${pkg.version}`) && /Built/.test(text) && /Commit/.test(text) && /System/.test(text) && /Web engine/.test(text), text.slice(0, 300));
check('it shows library counts and what’s new', /Your library/.test(text) && /Pages/.test(text) && /What’s new/.test(text) && /The first release/.test(text));
check('it says updates never phone home', /never checks for updates/.test(text));
await page.screenshot({ path: join(OUT, '1-general.png') });
await page.click('button:has-text("Copy diagnostics")');
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('Copy diagnostics puts the version and counts on the clipboard', clip.includes(`Canvas Notes ${pkg.version}`) && /Library: \d+ pages/.test(clip), clip);
await page.click('[role="tab"]:has-text("About")');
const about = await page.locator('.set-body').innerText();
check('About has privacy, credits and the shortcut list', /Privacy/.test(about) && /Built with/.test(about) && /Tauri/.test(about) && /Keyboard shortcuts/.test(about));
await page.screenshot({ path: join(OUT, '2-about.png') });
check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
