// A build made for one set of features starts with just that set (nothing saved yet).
// Run a dev server with the profile on its own port, then point this at it:
//   FEATURE_PROFILE=documents npx vite --port 1421   (in one terminal)
//   APP_URL=http://localhost:1421 EXPECT=documents node scripts/profile-build-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1421';
const EXPECT = process.env.EXPECT ?? 'documents';
function findChromium() {
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
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL);
await page.waitForSelector('.sidebar');
if (EXPECT !== 'notes') await page.waitForSelector('.sidebar >> text=Studio', { timeout: 30000 });
await page.waitForTimeout(500);
const nav = (await page.locator('.sidebar .side-section .nav-item').allInnerTexts()).map((t) => t.replace(/\s*\d+$/, '').trim());
if (EXPECT === 'notes') {
  check('the notes build has no Studio', !nav.includes('Studio') && nav.includes('Journal') && nav.includes('Cards'), nav.join(', '));
} else {
  check(`the ${EXPECT} build shows only Studio, All pages and Trash`, JSON.stringify([...nav].sort()) === JSON.stringify(['All pages', 'Studio', 'Trash']), nav.join(', '));
  await page.click('.sidebar >> text=Studio');
  await page.waitForSelector('.office-hub');
  const cols = await page.locator('.office-col').count();
  check(EXPECT === 'documents' ? 'and offers documents and spreadsheets only' : 'and offers documents, spreadsheets and presentations', cols === (EXPECT === 'documents' ? 2 : 3), String(cols));
}
// a saved choice in Settings still wins over the build's
await page.click('.side-settings');
await page.click('[role=tab]:has-text("Features")');
await page.click('[role=radio]:has-text("Everything")');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const all = (await page.locator('.sidebar .side-section .nav-item').allInnerTexts()).map((t) => t.replace(/\s*\d+$/, '').trim());
check('choosing Everything in Settings overrides the build', all.includes('Journal') && all.includes('Cards'), all.join(', '));
check('no errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
