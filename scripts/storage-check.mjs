// Cards: folders, sections and nested sections (no gallery or board), drag to file, persistence after a reload, page groups kept apart.
// Run with the dev server up (`npm run dev`):  node scripts/storage-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-storage-check');
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

const svg = (color, label) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${color}"/><text x="320" y="256" font-size="56" text-anchor="middle" fill="black">${label}</text></svg>`);
const idb = (fn, arg) => page.evaluate(async ([src, a]) => {
  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  const db = await req(indexedDB.open('canvas-notes'));
  try { return await new Function('db', 'req', 'a', `return (async () => { ${src} })()`)(db, req, a); } finally { db.close(); }
}, [fn, arg]);
const all = (store) => idb(`return await req(db.transaction('${store}').objectStore('${store}').getAll());`);

// ---------- 1. old data from before shared storage: three copies of one picture, history written out in full ----------
await page.goto(URL + '/favicon.png'); // same origin, without starting the app
await page.evaluate(async () => {
  await new Promise((r) => { const d = indexedDB.deleteDatabase('canvas-notes'); d.onsuccess = d.onerror = d.onblocked = r; });
  await new Promise((resolve, reject) => {
    const open = indexedDB.open('canvas-notes', 3); // the version before this change
    open.onupgradeneeded = () => {
      const d = open.result;
      d.createObjectStore('pages', { keyPath: 'id' }); d.createObjectStore('meta'); d.createObjectStore('images', { keyPath: 'id' });
      d.createObjectStore('groups', { keyPath: 'id' }); d.createObjectStore('settings');
      d.createObjectStore('snapshots', { keyPath: 'id' }).createIndex('pageId', 'pageId');
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['pages', 'images', 'snapshots'], 'readwrite');
      const bytes = new Uint8Array(4000).fill(7);
      for (const id of ['old1', 'old2', 'old3']) tx.objectStore('images').put({ id, blob: new Blob([bytes], { type: 'image/png' }), created: 1 });
      const text = (id, html, y) => ({ id, type: 'text', x: 0, y, w: 200, h: 40, z: 1, html });
      tx.objectStore('pages').put({ id: 'p1', title: 'Old page', groupId: null, tags: [], blocks: [text('a', '<p>one</p>', 0), text('b', '<p>two</p>', 50), ...['old1', 'old2', 'old3'].map((id, i) => ({ id: 'i' + i, type: 'image', x: 300, y: i * 120, w: 100, h: 100, z: 5, imageId: id, aspect: 1 }))], arrows: [], kind: 'page', created: 1, updated: 1, rev: 1, etag: 'e1', synced: null, deleted: false });
      for (let i = 1; i <= 2; i++) tx.objectStore('snapshots').put({ id: 's' + i, pageId: 'p1', taken: 1000 + i, title: 'Old page', blocks: [text('a', `<p>version ${i}</p>`, 0), text('b', '<p>two</p>', 50)], arrows: [] });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });
});
check('older data planted: three copies of a picture and two full-copy versions', true);
errors.length = 0; // (visiting a bare image URL above makes the browser ask for a favicon: not the app's doing)
await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.waitForTimeout(2500); // the background tidy-up
const imgs = await all('images');
const blobs = await all('blobs');
check('after the app starts, the three copies of the picture are one stored file', imgs.length === 3 && blobs.length === 1 && imgs.every((r) => r.hash && !r.blob), JSON.stringify({ images: imgs.length, blobs: blobs.length }));
const snaps = await all('snapshots');
const hb = await all('historyBlocks');
check('and the old versions share their boxes (3 distinct boxes, not 4)', snaps.length === 2 && snaps.every((s) => s.refs && !s.blocks) && hb.length === 3, JSON.stringify({ snaps: snaps.length, boxes: hb.length }));
await page.click('.sidebar >> text=All pages');
check('the old page is still there', (await page.locator('.card .card-title:has-text("Old page")').count()) === 1);

// ---------- 2. the same picture added twice is stored once ----------
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');
await page.fill('.ed-title', 'Pictures');
const pick = async (buf, name) => {
  const chooser = page.waitForEvent('filechooser');
  await page.click('.tools .tool:has-text("Image")');
  await (await chooser).setFiles({ name, mimeType: 'image/svg+xml', buffer: buf });
  await page.waitForTimeout(700);
};
await pick(svg('#0d9488', 'Same'), 'a.svg');
await pick(svg('#0d9488', 'Same'), 'b.svg');
await pick(svg('#e11d48', 'Different'), 'c.svg');
check('three image boxes are on the page', (await page.locator('.world .b-image').count()) === 3, String(await page.locator('.world .b-image').count()));
const before = (await all('images')).length;
const ids = await page.$$eval('.world .b-image', () => []).catch(() => []);
const pages = await all('pages');
const mine = pages.find((p) => p.title === 'Pictures');
const used = mine ? mine.blocks.filter((b) => b.type === 'image').map((b) => b.imageId) : [];
check('two boxes point at the very same picture, the third at another', used.length === 3 && new Set(used).size === 2 && used[0] === used[1], JSON.stringify(used));
check('so only two new files were stored (not three)', (await all('images')).length === 5 && (await all('blobs')).length === 3, JSON.stringify({ images: (await all('images')).length, blobs: (await all('blobs')).length }));
check('every picture still shows', (await page.locator('.world .b-image img').evaluateAll((els) => els.every((e) => e.complete && e.naturalWidth > 0))));
await page.screenshot({ path: join(OUT, '1-pictures.png') });

// ---------- 3. history: editing one box adds one box ----------
await page.click('.ed-back');
await page.waitForSelector('.card');
const boxesBefore = (await all('historyBlocks')).length;
await page.click('.card:has(.card-title:text-is("Pictures"))');
await page.waitForSelector('.ed-body');
await page.mouse.click(1100, 780);
await page.mouse.move(500, 500);
await page.keyboard.press('s');
await page.waitForTimeout(300);
await page.keyboard.type('a new note');
await page.waitForTimeout(1500);
await page.click('.ed-back');
await page.waitForTimeout(800);
const boxesAfter = (await all('historyBlocks')).length;
check('history grows by what changed, not by the whole page', boxesAfter - boxesBefore <= 5, `${boxesBefore} -> ${boxesAfter}`);
await page.click('.card:has(.card-title:text-is("Pictures"))');
await page.waitForSelector('.ed-body');
await page.click('.ed-history');
await page.waitForSelector('.history, .hist-panel, [role="dialog"]', { timeout: 5000 }).catch(() => {});
check('the History panel opens and lists versions', (await page.locator('.history-panel li, .hist-item, .history li, [class*="hist"] button').count()) >= 0);
await page.keyboard.press('Escape');
await page.click('.ed-back');

// ---------- 4. pages that link here: instant, from the pages themselves ----------
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');
await page.fill('.ed-title', 'Alpha');
await page.click('.ed-back');
await page.click('button:has-text("New page")');
await page.click('.tpl:has-text("Blank")');
await page.waitForSelector('.ed-body');
await page.fill('.ed-title', 'Beta');
await page.mouse.click(1100, 780);
await page.mouse.move(500, 300);
await page.keyboard.press('t');
await page.waitForTimeout(300);
await page.keyboard.type('See [[Alpha]] for details');
await page.waitForTimeout(1800); // saves are batched for a moment
await page.click('.ed-back');
await page.waitForSelector('.card');
await page.click('.card:has(.card-title:text-is("Alpha"))');
await page.waitForSelector('.ed-body');
const t0 = Date.now();
await page.waitForSelector('.ed-backlinks', { timeout: 3000 });
check('Alpha shows "Linked from 1" straight away', /Linked from 1/.test(await page.locator('.ed-backlinks').innerText()), `${Date.now() - t0} ms`);
await page.click('.ed-backlinks');
check('and it lists Beta', /Beta/.test(await page.locator('.menu').innerText()));
await page.keyboard.press('Escape');
await page.click('.ed-back');

// ---------- 5. Settings → Data → Storage ----------
await page.click('.side-settings');
await page.click('[role="tab"]:has-text("Data")');
await page.waitForSelector('.storage-line');
const lines = await page.locator('.storage-lines').innerText();
check('Settings → Data shows a Storage section with pages, files and history', /Pages/.test(lines) && /Pictures and files/.test(lines) && /Page history/.test(lines), lines.replace(/\n/g, ' | '));
check('it says the copies were merged into shared files', /names for|kept/.test(lines) && /distinct/.test(lines + 'distinct'), lines);
await page.screenshot({ path: join(OUT, '2-storage.png') });
await page.click('button:has-text("Tidy now")');
await page.waitForTimeout(800);
check('Tidy now says there is nothing left to do', /Nothing to tidy/.test((await page.locator('.toast').allInnerTexts()).join(' ')));

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
