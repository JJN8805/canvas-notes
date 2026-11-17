// The 3D page view: a page's boxes with a depth, placed and moved in 3D, written into from the view: the real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/space-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-space-check');
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

const screen = () => page.evaluate(() => document.querySelector('.space-body .tree3d-canvas').__screen());
const box = async (id) => (await screen()).boxes.find((b) => b.id === id);
const depthOf = async (id) => (await box(id)).depth;
const ink = () => page.evaluate(() => {
  const c = document.querySelector('.space-body .tree3d-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) h = (h * 31 + d[i - 3] + d[i - 2] * 7 + d[i - 1] * 13) | 0;
  return h;
});
const openSpace = async () => {
  await page.keyboard.press('Control+p');
  await page.waitForSelector('.palette');
  await page.fill('.palette input', 'in 3D');
  await page.click('.palette-row:has-text("in 3D")');
  await page.waitForSelector('.spaceview .tree3d-canvas');
  await page.waitForTimeout(500);
};
const pageBox = (id) => page.evaluate((id) => { const el = [...document.querySelectorAll('.world .block')].find((b) => b.textContent.includes(id)); const r = el?.getBoundingClientRect(); return r ? [Math.round(r.x), Math.round(r.y)].join(',') : null; }, id);

const startedAt = await pageBox('Background reading');
check('the page has a 3D button in its header', (await page.locator('.ed-space').count()) === 1);
await page.click('.ed-space');
await page.waitForSelector('.spaceview .tree3d-canvas');
await page.waitForTimeout(600);
check('it opens a 3D view with a box for every box on the page', (await screen()).boxes.length === 5, String((await screen()).boxes.length));
await page.screenshot({ path: join(OUT, 'space.png') });
const first = await screen();
const d = (id) => first.boxes.find((b) => b.id === id).depth;
check('a box that is behind another on the page is behind it in 3D (Idea two lies over Idea one)', d('n2') > d('n1') && d('n1') > 0, `n1 ${d('n1')}, n2 ${d('n2')}`);
check('boxes that are side by side on the page sit at the same depth', d('n3') === d('n4'), `n3 ${d('n3')}, n4 ${d('n4')}`);
check('boxes are blocks: a box shows its front and at least one side', first.boxes.filter((b) => b.id !== 'f1').every((b) => b.faces.includes('front') && b.faces.length >= 2), JSON.stringify(first.boxes.map((b) => b.faces)));
check('and none shows more than three faces', first.boxes.every((b) => b.faces.length <= 3));
await page.keyboard.press('Escape');
await openSpace();
check('the palette offers it on a page too (“Open this page in 3D”)', (await page.locator('.spaceview').count()) === 1);

/* ---- selecting, and changing depth ---- */
const n1 = await box('n1');
const n3 = await box('n3');
await page.mouse.click(n3.x, n3.y);
check('clicking a box selects it and shows its depth controls', (await screen()).selected === 'n3' && (await page.locator('.graph-panel input[aria-label="Depth"]').isEnabled()));
await page.locator('input[aria-label="Depth"]').fill('200');
await page.waitForTimeout(250);
check('the depth slider brings it nearer (and it grows on screen)', (await depthOf('n3')) === 200 && (await box('n3')).w > n3.w, `${n3.w} -> ${(await box('n3')).w}`);
await page.locator('.spaceview .tree3d-canvas').focus();
await page.keyboard.press('[');
await page.keyboard.press('[');
await page.waitForTimeout(150);
check('[ pushes it back and ] brings it nearer, 40 at a time', (await depthOf('n3')) === 120);
await page.keyboard.press(']');
check('', (await depthOf('n3')) === 160);
await page.click('.graph-panel button:has-text("On the page")');
check('"On the page" puts it back at depth 0', (await depthOf('n3')) === 0);

/* ---- moving a box on its layer, and Alt+drag for depth ---- */
const before = await box('n3');
await page.mouse.move(before.x, before.y);
await page.mouse.down();
await page.mouse.move(before.x + 100, before.y - 40, { steps: 10 });
const mid = await box('n3');
await page.mouse.up();
check('dragging a box moves it with the pointer', Math.hypot(mid.x - (before.x + 100), mid.y - (before.y - 40)) < 20, `${mid.x},${mid.y} vs ${before.x + 100},${before.y - 40}`);
const aBefore = await box('n2');
const depthBefore = aBefore.depth;
await page.keyboard.down('Alt');
await page.mouse.move(aBefore.x, aBefore.y);
await page.mouse.down();
await page.mouse.move(aBefore.x, aBefore.y - 60, { steps: 8 });
await page.mouse.up();
await page.keyboard.up('Alt');
check('Alt+drag changes its depth instead', (await depthOf('n2')) > depthBefore, `${depthBefore} -> ${await depthOf('n2')}`);

/* ---- locked boxes and frames stay put ---- */
const pinned = await box('n4');
await page.mouse.move(pinned.x, pinned.y);
await page.mouse.down();
await page.mouse.move(pinned.x + 80, pinned.y + 40, { steps: 6 });
await page.mouse.up();
const pinnedAfter = await box('n4');
check('a locked box does not move, and its depth cannot be changed', Math.abs(pinnedAfter.x - pinned.x) < 2 && (await page.locator('input[aria-label="Depth"]').isDisabled()));

/* ---- writing from the 3D view ---- */
const count = (await screen()).boxes.length;
await page.fill('input[aria-label="Write a note here"]', 'Remember the deadline');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('typing a note and pressing Enter puts a new note in the picture, selected', (await screen()).boxes.length === count + 1 && !!(await screen()).selected && (await page.inputValue('input[aria-label="Write a note here"]')) === '');

/* ---- arranging the whole page ---- */
await page.click('.graph-panel button:has-text("Layer like the page")');
await page.waitForTimeout(250);
const stacked = await screen();
const sd = (id) => stacked.boxes.find((b) => b.id === id).depth;
check('"Layer like the page" hands every box back to the page’s stacking', sd('n1') > 0 && sd('n2') > sd('n1'), `n1 ${sd('n1')}, n2 ${sd('n2')}`);
await page.click('.graph-panel button:has-text("Put everything on the page")');
await page.waitForTimeout(250);
check('"Put everything on the page" flattens them (a locked box stays as it was)', (await screen()).boxes.filter((b) => !['n4', 'f1'].includes(b.id)).every((b) => b.depth === 0));

/* ---- turning and zooming ---- */
const turned = await ink();
const cv = await page.locator('.spaceview .tree3d-canvas').boundingBox();
await page.mouse.move(cv.x + 40, cv.y + cv.height - 60);
await page.mouse.down();
await page.mouse.move(cv.x + 140, cv.y + cv.height - 40, { steps: 8 });
await page.mouse.up();
check('dragging the empty space turns the picture', (await ink()) !== turned);
const dist = (await screen()).camera.dist;
await page.mouse.wheel(0, -400);
await page.waitForTimeout(150);
check('scrolling zooms', (await screen()).camera.dist < dist);
await page.screenshot({ path: join(OUT, 'space-turned.png') });

/* ---- it all went through the page: it shows on the page, undoes, and stays after closing ---- */
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('the new note is on the page itself, with its text', (await page.locator('.world .block:has-text("Remember the deadline")').count()) === 1);
const movedAt = await pageBox('Background reading');
check('the box dragged in 3D has moved on the page itself', movedAt !== startedAt, `${startedAt} -> ${movedAt}`);
await page.locator('.world').click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
for (let i = 0; i < 14; i++) {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);
}
check('undo steps back through every 3D change: the box returns and the new note goes', (await pageBox('Background reading')) === startedAt && (await page.locator('.world .block:has-text("Remember the deadline")').count()) === 0, `${await pageBox('Background reading')} vs ${startedAt}`);
for (let i = 0; i < 14; i++) {
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(120);
}
check('and redo brings them back', (await pageBox('Background reading')) === movedAt && (await page.locator('.world .block:has-text("Remember the deadline")').count()) === 1);

/* ---- opening a box for editing goes back to the flat page ---- */
await openSpace();
const idea = await box('n3');
await page.mouse.dblclick(idea.x, idea.y);
await page.waitForTimeout(500);
check('double-clicking a box closes the view and takes you to it on the page', (await page.locator('.spaceview').count()) === 0 && (await page.locator('.world').count()) === 1);

/* ---- library: no 3D command there; and the view closes when the page is left ---- */
await openSpace();
await page.evaluate(() => (location.hash = '#/'));
await page.waitForTimeout(500);
check('leaving the page closes the 3D view', (await page.locator('.spaceview').count()) === 0);
await page.keyboard.press('Control+p');
await page.waitForSelector('.palette');
await page.fill('.palette input', 'in 3D');
await page.waitForTimeout(300);
check('the palette does not offer it away from a page', (await page.locator('.palette-row:has-text("in 3D")').count()) === 0);
await page.keyboard.press('Escape');

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
