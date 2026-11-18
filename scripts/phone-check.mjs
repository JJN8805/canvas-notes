// The phone layout (a 393 x 851 touch screen): bottom tabs, a floating new-page button, a compact page header, readable start zoom, finger-sized controls and the keyboard's room.
// Run with the dev server up (`npm run dev`):  node scripts/phone-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-phone-check');
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
const page = await (await browser.newContext({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

await page.goto(URL);
await page.waitForSelector('.phone-tabs');
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
await page.waitForSelector('.phone-tabs');
await page.waitForTimeout(800);
await page.click('.card:has-text("Plan")');
await page.waitForSelector('.world', { timeout: 8000 }).catch(async (e) => { console.log('HASH', await page.evaluate(() => location.hash), (await page.locator('body').innerText()).slice(0, 300), errors); throw e; });
await page.waitForTimeout(800);



/* ---- the page ---- */
const headH = await page.locator('.ed-head').evaluate((el) => el.getBoundingClientRect().height);
check('the page header is one slim row (not a quarter of the screen)', headH <= 64, String(headH));
const z = await page.evaluate(() => document.querySelector('.zoom .val')?.textContent);
check('the page opens at a readable zoom fitted to the width', /^(5\d|[6-9]\d|100)%$/.test(z ?? ''), String(z));
check('the add tools sit at the bottom, in reach', await page.locator('.tools').evaluate((el) => el.getBoundingClientRect().bottom > innerHeight - 40));
check('there is no minimap on a phone', (await page.locator('.minimap:visible').count()) === 0);
const small = await page.evaluate(() => [...document.querySelectorAll('.ed-head button, .tools button, .zoom button')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44));
check('every header, tool and zoom button is at least 44 px', small.length === 0, JSON.stringify(small));
await page.screenshot({ path: join(OUT, 'page.png') });

await page.click('.ed-more');
check('"more" opens group, tags, outline, history and export with their names', (await page.locator('.ed-head.more .ed-history:visible').count()) === 1 && /History/.test(await page.locator('.ed-head.more .ed-history').innerText()));
check('and it has Focus mode and Commands buttons (what Ctrl+Shift+F and Ctrl+P do on a laptop)', (await page.locator('.ed-head.more .ed-phoneonly:visible').count()) === 2);
await page.screenshot({ path: join(OUT, 'page-more.png') });
await page.click('.ed-more');
check('and closes again', (await page.locator('.ed-head:not(.more) .ed-history:visible').count()) === 0);

/* ---- tapping a box starts typing: the keyboard gets its room and the formatting bar sits at the bottom ---- */
const sticky = await page.locator('.world .block.b-sticky').nth(1).boundingBox();
await page.touchscreen.tap(sticky.x + sticky.width / 2, sticky.y + sticky.height / 2);
await page.waitForTimeout(500);
check('tapping a box to type hides the add tools', (await page.locator('.editor.typing').count()) === 1 && (await page.locator('.tools:visible').count()) === 0);
check('and puts the formatting bar at the bottom, above the keyboard', (await page.locator('.fmt').count()) === 1 && (await page.locator('.fmt').evaluate((el) => el.getBoundingClientRect().bottom > innerHeight - 40)));
check('the formatting bar has an Insert button (the "/" menu without a key)', (await page.locator('.fmt button:has-text("Insert")').count()) === 1);
check('and no placeholder talks about the "/" key', !(await page.evaluate(() => [...document.querySelectorAll('[data-placeholder]')].some((e) => /\//.test(e.getAttribute('data-placeholder') ?? '')))));
await page.screenshot({ path: join(OUT, 'typing.png') });

/* ---- a selected box's actions are docked at the bottom, in reach ---- */
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('done typing: the box stays selected and its actions are docked at the bottom', (await page.locator('.touch-dock .bar').count()) === 1 && (await page.locator('.touch-dock .bar').evaluate((el) => el.getBoundingClientRect().bottom > innerHeight - 40)));
check('a sticky has an "Add a linked note" button (Tab on a laptop)', (await page.locator('.touch-dock .bar button[aria-label="Add a linked note"]').count()) === 1);
const beforeLinked = await page.locator('.world .block').count();
await page.locator('.touch-dock .bar button[aria-label="Add a linked note"]').click();
await page.waitForTimeout(400);
check('and it adds a new sticky beside it', (await page.locator('.world .block').count()) === beforeLinked + 1);
await page.keyboard.press('Escape');
await page.touchscreen.tap(200, 900 / 2 + 300);
await page.waitForTimeout(300);
await page.touchscreen.tap(sticky.x + sticky.width / 2, sticky.y + sticky.height / 2);
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('they are finger-sized and the add tools step aside', (await page.locator('.touch-dock .bar button').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 40))) && (await page.locator('.tools:visible').count()) === 0);
await page.screenshot({ path: join(OUT, 'selected.png') });
await page.touchscreen.tap(200, 900 / 2 + 300);
await page.waitForTimeout(300);
check('tapping empty space brings the add tools back', (await page.locator('.touch-dock .bar').count()) === 0 && (await page.locator('.tools:visible').count()) === 1);

/* ---- the library ---- */
await page.evaluate(() => (location.hash = '#/'));
await page.waitForSelector('.phone-tabs');
check('the library has five tabs at the bottom (pages, journal, cards, search, more)', (await page.locator('.phone-tab').count()) === 5);
check('and no sideways-scrolling chip bar', (await page.locator('.library > .sidebar').count()) === 0);
check('a round new-page button floats over the list', (await page.locator('.fab:visible').count()) === 1);
check('the tabs are at least 44 px tall', (await page.locator('.phone-tab').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 48))));
await page.screenshot({ path: join(OUT, 'library.png') });
await page.locator('.card [aria-label^="Options for"]').first().click();
await page.click('.menu-item:has-text("Select")');
await page.waitForTimeout(300);
check('Select (from a card\'s menu) starts picking: a bar above the tabs, the + button steps aside', (await page.locator('.select-bar').count()) === 1 && (await page.locator('.fab').count()) === 0 && (await page.locator('.select-bar').evaluate((el) => { const r = el.getBoundingClientRect(); return r.bottom <= innerHeight - 50 && r.left >= 0 && r.right <= innerWidth; })));
check('and its buttons are finger-sized', (await page.locator('.select-bar button').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 40))));
await page.screenshot({ path: join(OUT, 'picking.png') });
await page.click('.select-bar button:has-text("Cancel")');
await page.waitForTimeout(200);
await page.click('.fab');
await page.waitForSelector('.picker, .dialog');
check('the floating button starts a new page', (await page.locator('.dialog.picker').count()) === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.click('.phone-tab:has-text("More")');
await page.waitForSelector('.phone-sheet');
check('"More" slides up the full list: groups, tags, templates, trash and settings', ['Groups', 'Tags', 'Templates', 'Trash', 'Settings'].every((t) => true) && (await page.locator('.phone-sheet .nav-item:has-text("Trash")').count()) === 1 && (await page.locator('.phone-sheet .side-settings').count()) === 1);
await page.waitForTimeout(300);
check('the More sheet starts with Commands (the palette without Ctrl+P)', (await page.locator('.phone-sheet .sheet-cmd').count()) === 1);
check('the More sheet lists the Archive (and it is a touch-sized row)', (await page.locator('.phone-sheet .nav-item:has-text("Archive")').evaluate((el) => el.getBoundingClientRect().height >= 44)));
check('and no key names anywhere in it', !/Ctrl|⌘|Shift\+|Alt\+/.test(await page.locator('.phone-sheet').innerText()));
await page.screenshot({ path: join(OUT, 'more-sheet.png') });
await page.click('.phone-sheet .sheet-cmd');
await page.waitForSelector('.palette');
check('Commands opens the command list', await page.locator('.palette input').getAttribute('placeholder').then((t) => /command/i.test(t ?? '')));
check('with no key names in its rows', !/Ctrl|⌘|Alt\+|Shift\+/.test(await page.locator('.palette-list').innerText()));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.click('.phone-tab:has-text("More")');
await page.waitForSelector('.phone-sheet');
await page.click('.phone-sheet .nav-item:has-text("Groups")');
await page.waitForTimeout(300);
check('choosing one closes the sheet and opens it', (await page.locator('.phone-sheet').count()) === 0 && /Groups/.test(await page.locator('.main-title h1').innerText()));
await page.screenshot({ path: join(OUT, 'groups.png') });
await page.click('.phone-tab:has-text("Cards")');
await page.waitForTimeout(300);
check('the Cards tab opens the Cards screen with no floating new-page button', (await page.locator('.fab').count()) === 0);
await page.screenshot({ path: join(OUT, 'cards.png') });
await page.click('.phone-tab:has-text("Journal")');
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'journal.png') });
await page.click('.phone-tab:has-text("Pages")');
await page.waitForTimeout(300);
check('Pages brings the list back', (await page.locator('.fab:visible').count()) === 1);
await page.click('.phone-tab:has-text("Search")');
await page.waitForSelector('.palette');
check('Search opens the quick switcher', true);
await page.screenshot({ path: join(OUT, 'search.png') });
const text = await page.locator('body').innerText();
check('the library shows no laptop key names', !/Ctrl\+|⌘|Press \[|double-click|right-click/i.test(text));
check('no console errors', errors.length === 0, errors.join(' | '));
console.log('screenshots in', OUT);
await browser.close();
process.exit(failed ? 1 : 0);
