// Opens the running dev app (`npm run dev`) in headless Chromium, walks through every main screen with sample data,
// saves a screenshot of each to .visual/, and fails on any console error, failed request or uncaught exception.
// Read the screenshots afterwards: this catches what the type checker and the tests cannot.
//   npm run dev        (in one terminal)
//   npm run visual     (in another; set APP_URL for a different address)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tinyPdf, wav } from './fixtures.mjs';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(process.cwd(), '.visual');

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) if (existsSync(join(root, d, sub))) return join(root, d, sub);
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
const page = await ctx.newPage();
const problems = [];
const watch = (p, tag) => {
  p.on('console', (m) => m.type() === 'error' || m.type() === 'warning' ? problems.push(`${tag} ${m.type()}: ${m.text().slice(0, 240)}`) : 0);
  p.on('pageerror', (e) => problems.push(`${tag} exception: ${e.message}`));
  p.on('response', (r) => (r.status() >= 400 ? problems.push(`${tag} HTTP ${r.status()} ${r.url()}`) : 0));
};
watch(page, 'app');
let n = 0;
const shot = async (name, pg = page) => {
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
};
const svg = (color, label) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${color}"/><circle cx="320" cy="240" r="120" fill="white" opacity=".35"/><text x="320" y="260" font-size="64" text-anchor="middle" fill="white" font-family="sans-serif">${label}</text></svg>`);

await page.goto(URL);
await page.waitForSelector('.sidebar');
await shot('library-empty');

// A page, and a selected box (resize handles)
await page.click('text=Open an example page');
await page.waitForSelector('.block');
await shot('editor');
const box = await page.locator('.block').first().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await shot('editor-selected-box');
const pageId = (await page.evaluate(() => location.hash)).split('/').pop();
const blocks = await page.$$eval('.block', (els) => els.map((e) => [e.dataset.id, e.className]));
const tag = page.locator('.tag-input').first();
if (await tag.count()) for (const t of ['ideas', 'canvas']) { await tag.fill(t); await tag.press('Enter'); }
// Audio and PDF boxes: add a real WAV and a real two-page PDF from the toolbar
await page.setInputFiles('input[accept^="audio"]', { name: 'team_standup.wav', mimeType: 'audio/wav', buffer: wav() });
await page.waitForSelector('.audio-body audio');
await page.setInputFiles('input[accept^="application/pdf"]', { name: 'Contract.pdf', mimeType: 'application/pdf', buffer: tinyPdf(['First page', 'Second page']) });
await page.waitForSelector('.pdf-body canvas', { timeout: 20000 });
await page.waitForFunction(() => {
  const c = document.querySelector('.pdf-body canvas');
  if (!c || !c.width) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128) return true; // some dark (text) pixel
  return false;
}, null, { timeout: 20000 }).catch(() => problems.push('pdf: the first page was not drawn (canvas stayed blank)'));
if (!(await page.locator('.audio-name', { hasText: 'team standup' }).count())) problems.push('audio: the box should be named from the file ("team standup")');
if (!(await page.locator('.audio-len', { hasText: '0:01' }).count())) problems.push('audio: the clip length (0:01) was not shown');
if (!(await page.locator('.pdf-count', { hasText: '1 / 2' }).count())) problems.push('pdf: expected "1 / 2" under the page');
// Both were placed at the middle of the view, so the tall PDF covers the clip: drag the PDF aside by its name strip
const strip = await page.locator('.pdf-name').boundingBox();
await page.mouse.move(strip.x + 20, strip.y + 10);
await page.mouse.down();
await page.mouse.move(strip.x + 220, strip.y + 10, { steps: 8 });
await page.mouse.up();
const moved = await page.locator('.pdf-name').boundingBox();
if (Math.abs(moved.x - strip.x) < 100) problems.push('pdf: dragging the box by its name strip did not move it');
await shot('audio-pdf-boxes');
await page.click('.pdf-nav.next');
await page.waitForFunction(() => document.querySelector('.pdf-count')?.textContent?.includes('2 / 2'));
if (!(await page.locator('.pdf-nav.next').isDisabled())) problems.push('pdf: Next should be disabled on the last page');
await shot('pdf-page-2');
// Search by block type finds the page; a rejected file says why instead of failing silently
await page.setInputFiles('input[accept^="audio"]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
await page.waitForSelector('text=Only pictures, audio and PDF files');
await shot('media-rejected');
await page.click('.ed-back');
await page.waitForSelector('.sidebar');
await shot('library-with-page');

// Groups
await page.click('.sidebar >> text=Groups');
for (const name of ['Work', 'Personal']) {
  await page.click('button:has-text("New group")');
  await page.fill('.dialog input', name);
  await page.click('.dialog button.primary');
}
await page.click('article.bcard:has-text("Work") .bmenu');
await page.click('text=New subgroup…');
await page.fill('.dialog input', 'ML projects');
await page.click('.dialog button.primary');
await shot('groups');
await page.click('article.bcard:has-text("Work")');
await shot('group-open');
await page.click('.sidebar >> text=Groups');
await page.fill('input[aria-label="Search groups"]', 'work ml');
await shot('groups-search');

// Tags
await page.click('.sidebar >> text=Tags');
await shot('tags');

// Page search operators: #tag narrows, an unknown tag empties the list with the helpful empty state
await page.click('.sidebar >> text=All pages');
await page.fill('input[aria-label="Search pages"]', '#guide');
await shot('search-tag');
await page.fill('input[aria-label="Search pages"]', '#nosuchtag has:image after:2020-01-01');
await shot('search-empty');
if (!(await page.locator('text=No pages match your search').count())) problems.push('search: an impossible query should show "No pages match your search"');
await page.fill('input[aria-label="Search pages"]', '');

// Cards, typing into the details (a regression check: focus must stay in the editor)
await page.click('.sidebar >> text=Cards');
for (const [color, label, text] of [['#e11d48', 'Tokyo', 'Flights booked for March.'], ['#0d9488', 'Garden', 'Tomatoes and basil.'], [null, 'No picture', 'A plain card']]) {
  await page.click('button:has-text("New card")');
  await page.waitForSelector('.card-detail');
  await page.fill('.cd-label', label);
  if (color) await page.setInputFiles('.card-detail input[type=file]', { name: 'c.svg', mimeType: 'image/svg+xml', buffer: svg(color, label) });
  await page.click('.cd-body .ProseMirror');
  await page.keyboard.type(text);
  if (label === 'Tokyo') await shot('card-detail');
  await page.click('.card-detail button:has-text("Done")');
}
const tiles = await page.locator('.ctile').count();
if (tiles !== 3) problems.push(`cards: expected 3 tiles, found ${tiles} (typing may be creating extra cards)`);
await shot('cards');
await page.fill('input[aria-label="Search cards"]', 'basil');
await shot('cards-search');
await page.fill('input[aria-label="Search cards"]', '');

// Card tags and sets: tag two cards, filter by a tag chip, put a card in a set and show only that set
for (const [label, tag] of [['Tokyo', 'travel'], ['Garden', 'plants']]) {
  await page.click(`.ctile:has-text("${label}")`);
  await page.waitForSelector('.card-detail');
  await page.fill('input[aria-label="Add a tag to this card"]', tag);
  await page.keyboard.press('Enter');
  if (label === 'Tokyo') {
    const opts = await page.locator('select[aria-label="Set (group) this card belongs to"] option').count();
    if (opts < 2) problems.push('card sets: the set picker lists no groups');
    else await page.selectOption('select[aria-label="Set (group) this card belongs to"]', { index: 1 });
    await shot('card-detail-tags');
  }
  await page.click('.card-detail button:has-text("Done")');
}
await page.click('.tagbar button:has-text("#plants")');
if ((await page.locator('.ctile').count()) !== 1) problems.push('card tags: the #plants chip should leave exactly one card');
await shot('cards-tag-filter');
await page.click('.tagbar button:has-text("#plants")');
await page.selectOption('select[aria-label="Show set of cards"]', '-');
if ((await page.locator('.ctile').count()) !== 2) problems.push('card sets: "No set" should show the two cards not put in a set');
await shot('cards-set-filter');
await page.selectOption('select[aria-label="Show set of cards"]', '');

// Board: columns per set, drag a card to another column
await page.click('button.seg-btn:has-text("Board")');
await shot('cards-board');
const colCount = async (title) => Number(await page.locator(`.kb-col:has(h2[title="${title}"]) .kb-head .cnt`).textContent());
const workBefore = await colCount('Work');
await page.locator('.kb-card:has-text("Garden")').dragTo(page.locator('.kb-col:has(h2[title="Work"]) .kb-body'));
const workAfter = await colCount('Work');
if (workAfter !== workBefore + 1) problems.push(`card board: dragging Garden onto Work should add one card there (had ${workBefore}, now ${workAfter})`);
await shot('cards-board-dragged');
await page.click('button.seg-btn:has-text("Gallery")');

// Settings: every tab must be reachable
await page.click('.side-settings');
await shot('settings');
for (const t of ['Appearance', 'Editor', 'Sync', 'Desktop', 'Add-ons', 'Data', 'About']) {
  const tab = page.locator(`[role=tab]:has-text("${t}")`);
  if (!(await tab.isVisible())) problems.push(`settings: tab ${t} is not visible`);
  else await tab.click();
}
await shot('settings-last-tab');
// Encrypted backup: the passphrase prompt is masked, and a mismatch saves nothing
await page.click('[role=tab]:has-text("Data")');
await page.click('button:has-text("Encrypted backup")');
const pw = page.locator('input[type=password]');
if ((await pw.count()) !== 1) problems.push('encrypted backup: the passphrase field must be a masked (password) field');
await pw.fill('first');
await shot('backup-passphrase');
await page.keyboard.press('Enter');
await page.locator('input[type=password]').fill('second');
await page.keyboard.press('Enter');
if (!(await page.locator('text=passphrases didn').count())) problems.push('encrypted backup: mismatched passphrases should say so');
await page.keyboard.press('Escape');

// Desktop widgets (layout only: the desktop shell isn't there in a browser)
const w = await ctx.newPage();
watch(w, 'widget');
for (const [name, cls, size] of [['text', 'b-text', [420, 260]], ['list', 'b-checklist', [360, 300]], ['table', 'b-table', [460, 340]]]) {
  const id = blocks.find((b) => b[1].includes(cls))?.[0];
  await w.setViewportSize({ width: size[0], height: size[1] });
  await w.goto(`${URL}/?widget=${pageId}&block=${id}`, { waitUntil: 'domcontentloaded' });
  await w.waitForSelector('.widget-body .block');
  await shot(`widget-${name}`, w);
}
await w.setViewportSize({ width: 560, height: 440 });
await w.goto(`${URL}/?widget=${pageId}`, { waitUntil: 'domcontentloaded' }); // the dev server is slow to serve the PDF worker the first time; the selector waits below are what matter
await w.waitForSelector('.widget-body .viewport');
await shot('widget-page', w);
await w.goto(`${URL}/?widget=${pageId}&block=missing`, { waitUntil: 'domcontentloaded' });
await w.waitForSelector('.widget-gone');
await shot('widget-deleted', w);

await browser.close();
console.log(`${n} screenshots in ${OUT}`);
if (problems.length) {
  console.error('\nPROBLEMS:\n' + [...new Set(problems)].join('\n'));
  process.exit(1);
}
console.log('No console errors, failed requests or uncaught exceptions.');
