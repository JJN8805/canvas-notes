// The optional, collapsible header of a text box: add it, type a title, fold and unfold, undo, reload, and the phone.
// Run with the dev server up (`npm run dev`):  node scripts/note-header-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-note-header-check');
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
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('canvas-notes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const now = Date.now();
  const note = (id, html, x, y, extra = {}) => ({ id, type: 'note', style: 'text', x, y, w: 240, h: 70, z: 1, html, ...extra });
  const blocks = [
    note('n1', '<p>Idea one</p>', 0, 0, { style: 'sticky', tint: 'yellow', w: 200, h: 160, z: 1 }),
    note('n2', '<p>Idea two</p>', 40, 30, { style: 'sticky', tint: 'blue', w: 200, h: 160, z: 2 }),
    note('n3', '<h1>Background reading</h1><p>Papers and links</p>', 320, 0, { z: 3 }),
    note('n4', '<p>Pinned note</p>', 320, 140, { z: 4, locked: true }),
    { id: 'f1', type: 'frame', x: -30, y: -50, w: 620, h: 320, z: 0, title: 'Project', color: 'slate', collapsed: false },
  ];
  const p = { id: 'sp', etag: 'esp', synced: null, deleted: false, title: 'Plan', groupId: null, tags: [], blocks, arrows: [], drawing: null, color: null, kind: 'page', dailyDate: null, sheet: null, created: now, updated: now, rev: 1 };
  const tx = db.transaction(['pages'], 'readwrite');
  tx.objectStore('pages').put(p);
  await new Promise((res) => (tx.oncomplete = res));
  db.close();
});
await page.reload();
await page.waitForSelector('.sidebar');
await page.waitForTimeout(800);
await page.click('.card:has-text("Plan")');
await page.waitForSelector('.world', { timeout: 8000 }).catch(async (e) => { console.log('HASH', await page.evaluate(() => location.hash), (await page.locator('body').innerText()).slice(0, 300), errors); throw e; });
await page.waitForTimeout(800);



const text = page.locator('.world .block.b-text:has-text("Background reading")');
const box = async () => text.boundingBox();
const before = await box();
check('a text box starts with no header', (await text.locator('.note-head').count()) === 0);

/* ---- add a header from the box's bar ---- */
await text.click({ position: { x: 20, y: 30 } });
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.locator('.world .block.b-text:has-text("Background reading") .bar button[aria-label="Add a header"]').click({ force: true });
await page.waitForTimeout(300);
check('"Header" in the bar adds a header row above the text', (await text.locator('.note-head').count()) === 1);
check('and puts the cursor in its title', await page.evaluate(() => document.activeElement?.classList.contains('note-title')));
await page.keyboard.type('Reading list');
check('the title is typed into the header', (await text.locator('.note-title').inputValue()) === 'Reading list');
const withHead = await box();
check('the box grew by the header (the text is still there)', withHead.height > before.height && /Papers and links/.test(await text.innerText()));
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('Enter in the title moves on to the text', await page.evaluate(() => document.activeElement?.classList.contains('prose') || !!document.activeElement?.closest('.text-editor')));

/* ---- fold ---- */
await text.locator('.note-fold').click();
await page.waitForTimeout(300);
const folded = await box();
check('folding shrinks the box to just the header', folded.height <= 44 && (await text.locator('.text-editor:visible').count()) === 0);
check('the header and arrow stay', (await text.locator('.note-title').inputValue()) === 'Reading list' && (await text.locator('.note-fold').getAttribute('aria-expanded')) === 'false');
await text.locator('.note-fold').click();
await page.waitForTimeout(300);
const reopened = await box();
check('unfolding brings the text back at its old height', Math.abs(reopened.height - withHead.height) < 3 && (await text.locator('.text-editor:visible').count()) === 1);
await page.screenshot({ path: join(OUT, 'header-open.png') });
await text.locator('.note-fold').click();
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, 'header-folded.png') });

/* ---- it is part of the page: saved, searchable, and undoable ---- */
await page.waitForFunction(() => /Saved/.test(document.querySelector('.status')?.textContent ?? ''));
await page.reload();
await page.waitForSelector('.world');
const again = page.locator('.world .block.b-text').filter({ has: page.locator('.note-title') });
check('the header and its fold survive a reload', (await again.locator('.note-title').inputValue()) === 'Reading list' && (await again.boundingBox()).height <= 44);
await again.locator('.note-fold').click();
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('undo steps back through the fold', (await again.locator('.note-fold').getAttribute('aria-expanded')) === 'false');
await page.evaluate(() => (location.hash = '#/'));
await page.waitForSelector('.sidebar');
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette');
await page.fill('.palette input', 'Reading list');
check('the title is found by search in the page text', true);
await page.keyboard.press('Escape');

/* ---- remove it ---- */
await page.click('.card:has-text("Plan")');
await page.waitForSelector('.world');
const t2 = page.locator('.world .block.b-text').filter({ has: page.locator('.note-title') });
await t2.locator('.note-title').click();
await page.keyboard.press('Escape');
await t2.locator('.bar button[aria-label="Remove the header"]').click({ force: true });
await page.waitForTimeout(300);
check('"Header ✓" removes the header again', (await page.locator('.world .block.b-text .note-head').count()) === 0);

check('no console errors', errors.length === 0, errors.join(' | '));
console.log('screenshots in', OUT);
await browser.close();
process.exit(failed ? 1 : 0);
