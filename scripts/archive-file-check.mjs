// The archive file (.zip): save everything incl. a GIF as normal files, then restore it into a fresh browser profile (headless Chromium).
// Run with the dev server up:  node scripts/archive-file-check.mjs
import { chromium } from 'playwright-core';
import { unzipSync } from 'fflate';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-archive-file-check');
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
const gifPath = join(OUT, 'anim.gif');
writeFileSync(gifPath, Buffer.from('R0lGODlhAgACAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAgAAACwAAAAAAgACAAACAkQBACH5BAACAAAALAAAAAACAAIAgAD/AAAAAAIChEwAIfkEAAIAAAAsAAAAAAIAAgCAAAD/AAAAAgKETAA7', 'base64'));

async function open(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
  page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));
  await page.goto(URL);
  await page.waitForSelector('.sidebar');
  return { page, errors };
}

/* ---- first library: a page, a card with a GIF cover ---- */
const a = await open(await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true }));
await a.page.click('.nav-item:has-text("All pages")');
await a.page.click('button:has-text("Open an example page")');
await a.page.waitForSelector('.world');
await a.page.evaluate(() => (location.hash = '#/'));
await a.page.click('.nav-item:has-text("Cards")');
await a.page.click('main button:has-text("New card")');
await a.page.waitForSelector('.cd-label');
await a.page.fill('.cd-label', 'Moving GIF');
await a.page.locator('.cd-cover input[type=file]').setInputFiles(gifPath);
await a.page.waitForSelector('.cd-cover img');
await a.page.click('.cd-actions button:has-text("Done")');
await a.page.waitForTimeout(1500);

/* ---- save the archive file ---- */
await a.page.click('.side-settings');
await a.page.click('[role=tab]:has-text("Data")');
check('Settings → Data offers an archive file next to the backups', (await a.page.locator('button:has-text("Archive file")').count()) === 1);
check('and no automatic-archive section in a browser (it is for the laptop app)', (await a.page.locator('text=Automatic archive').count()) === 0);
const [download] = await Promise.all([a.page.waitForEvent('download'), a.page.click('button:has-text("Archive file")')]);
check('the file is dated and is a .zip', /^canvas-notes-archive-\d{4}-\d{2}-\d{2}\.zip$/.test(download.suggestedFilename()), download.suggestedFilename());
const zipPath = join(OUT, download.suggestedFilename());
await download.saveAs(zipPath);
const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
const names = Object.keys(entries);
check('it holds the data file, a readme and the GIF as a normal file', names.includes('canvas-notes-archive.json') && names.includes('README.txt') && names.some((n) => /^files\/.+\.gif$/.test(n)), names.join(','));
const gifEntry = names.find((n) => n.endsWith('.gif'));
check('the GIF inside is byte for byte the one added', Buffer.compare(Buffer.from(entries[gifEntry]), readFileSync(gifPath)) === 0);
const manifest = JSON.parse(new TextDecoder().decode(entries['canvas-notes-archive.json']));
check('the data file lists the pages (the example page and the card)', manifest.counts.pages >= 2 && manifest.files.length === 1, JSON.stringify(manifest.counts));
check('no console errors while saving', a.errors.length === 0, a.errors.join(' | '));

/* ---- restore it into a brand-new browser profile ---- */
const b = await open(await browser.newContext({ viewport: { width: 1400, height: 900 } }));
check('the second library starts empty', (await b.page.locator('.nav-item:has-text("Cards") .cnt').innerText()) === '0');
await b.page.click('.side-settings');
await b.page.click('[role=tab]:has-text("Data")');
await b.page.locator('input[type=file][accept*=".zip"]').setInputFiles(zipPath);
await b.page.waitForSelector('button:text-is("Restore")');
await b.page.click('button:text-is("Restore")');
await b.page.waitForTimeout(1500);
await b.page.keyboard.press('Escape');
await b.page.click('.nav-item:has-text("Cards")');
await b.page.waitForSelector('.ctile');
check('the card comes back', (await b.page.locator('.ctile:has-text("Moving GIF")').count()) === 1);
await b.page.waitForSelector('.ctile-cover img', { timeout: 15000 });
check('with its GIF', (await b.page.locator('.ctile-cover img').evaluate((i) => i.complete && i.naturalWidth === 2)));
await b.page.click('.nav-item:has-text("All pages")');
check('and the page comes back', (await b.page.locator('.card').count()) >= 1);

/* ---- a file that is not an archive is refused with a reason ---- */
const bad = join(OUT, 'not-an-archive.zip');
writeFileSync(bad, Buffer.from('PK\x03\x04 this is not really a zip'));
await b.page.click('.side-settings');
await b.page.click('[role=tab]:has-text("Data")');
await b.page.locator('input[type=file][accept*=".zip"]').setInputFiles(bad);
await b.page.waitForTimeout(500);
check('a broken zip is refused with a message', /isn’t a Canvas Notes archive/.test(await b.page.locator('body').innerText()));
check('no console errors while restoring', b.errors.length === 0, b.errors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
