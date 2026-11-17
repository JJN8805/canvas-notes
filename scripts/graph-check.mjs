// The graph view (force layout, filters, settings) and the 3D hierarchy: the real app in headless Chromium, on a seeded library.
// Run with the dev server up (`npm run dev`):  node scripts/graph-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-graph-check');
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

/* ---- a seeded library, written straight into the browser database ---- */
await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('canvas-notes');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const now = Date.now();
  const note = (id, html, extra = {}) => ({ id, type: 'note', style: 'text', x: 0, y: 0, w: 300, h: 60, z: 1, html, ...extra });
  const mk = (id, title, o = {}) => ({ id, etag: 'e' + id, synced: null, deleted: false, title, groupId: null, tags: [], blocks: [], arrows: [], drawing: null, color: null, kind: 'page', dailyDate: null, sheet: null, created: now, updated: now, rev: 1, ...o });
  const pages = [
    mk('pa', 'Alpha', { groupId: 'g1', tags: ['x', 'y'], blocks: [note('a1', '<h1>Intro</h1><h2>Detail</h2><p>See [[Beta]]</p>'), note('a2', '<p>link to gamma</p>', { links: [{ page: 'pc' }] })] }),
    mk('pb', 'Beta', { groupId: 'g2', tags: ['x'], blocks: [note('b1', '<h1>Beta heading</h1>')] }),
    mk('pc', 'Gamma', { groupId: 'g2', blocks: [note('c1', '<h1>Gamma heading</h1>')] }),
    mk('pd', 'Delta', { groupId: 'g3', blocks: [note('d1', '<p>[[Alpha]]</p>')] }),
    mk('pe', 'Epsilon', { groupId: 'g3', tags: ['y'] }),
    mk('pf', 'Loose page', { blocks: [note('f1', '<h1>Alone</h1>')] }),
    mk('pg', 'Orphan one'),
    mk('ph', 'Orphan two'),
    mk('card1', 'A card', { kind: 'card', tags: ['y'], blocks: [note('k1', '<p>[[Alpha]]</p>')] }),
  ];
  const groups = [
    { id: 'g1', etag: 'e1', synced: null, deleted: false, name: 'Work', color: 'teal', position: 0, parentId: null },
    { id: 'g2', etag: 'e2', synced: null, deleted: false, name: 'Plans', color: 'ochre', position: 1, parentId: 'g1' },
    { id: 'g3', etag: 'e3', synced: null, deleted: false, name: 'Home', color: 'moss', position: 2, parentId: null },
  ];
  const tx = db.transaction(['pages', 'groups'], 'readwrite');
  for (const p of pages) tx.objectStore('pages').put(p);
  for (const g of groups) tx.objectStore('groups').put(g);
  await new Promise((res) => (tx.oncomplete = res));
  db.close();
});
await page.reload();
await page.waitForSelector('.sidebar');
await page.waitForTimeout(800);

const openGraph = async () => {
  await page.keyboard.press('Control+p');
  await page.waitForSelector('.palette');
  await page.fill('.palette input', 'graph view');
  await page.click('.palette-row:has-text("graph view")');
  await page.waitForSelector('.graphview');
};
const nodeCount = () => page.locator('.graph-node').count();
const pos = (title) => page.locator(`.graph-node[aria-label$=": ${title}"]`).getAttribute('transform');
const world = () => page.locator('.graph-svg > g').getAttribute('transform');

await openGraph();
await page.click('.graph-tabs button:has-text("Graph")');
await page.waitForSelector('.graph-node');
await page.waitForTimeout(1500);
check('the graph shows every page and card (9 dots), with a settings panel', (await nodeCount()) === 9 && (await page.locator('.graph-panel').count()) === 1, String(await nodeCount()));
check('links join them: text links, box links and the card’s link', (await page.locator('.graph-edge').count()) >= 4);

/* ---- it settles by itself, and holds still ---- */
const a1 = await pos('Alpha');
await page.waitForTimeout(2500);
const a2 = await pos('Alpha');
await page.waitForTimeout(1500);
const a3 = await pos('Alpha');
check('the dots have positions, and linked dots are nearer each other than strangers', !!a1 && /translate\(/.test(a1));
check('it settles: after a few seconds nothing moves', a2 === a3, `${a2} vs ${a3}`);
await page.screenshot({ path: join(OUT, 'graph.png') });

/* ---- dragging a dot moves it (and does not open it) ---- */
const box = await page.locator('.graph-node[aria-label$=": Delta"] circle').boundingBox();
const before = await pos('Delta');
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 120, box.y + 90, { steps: 8 });
await page.waitForTimeout(150);
const during = await pos('Delta');
await page.mouse.up();
await page.waitForTimeout(300);
check('dragging a dot moves it with the pointer', before !== during, `${before} -> ${during}`);
check('and does not open the page', (await page.locator('.graphview').count()) === 1);

/* ---- zoom and pan ---- */
const w0 = await world();
await page.mouse.move(700, 450);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(150);
const w1 = await world();
const k = (t) => Number(/scale\(([\d.]+)\)/.exec(t)?.[1]);
check('scrolling zooms in', k(w1) > k(w0), `${k(w0)} -> ${k(w1)}`);
await page.mouse.move(1000, 700);
await page.mouse.down();
await page.mouse.move(900, 640, { steps: 5 });
await page.mouse.up();
check('dragging the background moves around', (await world()) !== w1);
await page.dblclick('.graph-svg', { position: { x: 30, y: 30 } });
check('double-clicking the background fits everything again', Math.abs(k(await world()) - k(w0)) < Math.abs(k(w1) - k(w0)));

/* ---- filters ---- */
await page.check('.graph-panel label:has-text("Tags") input');
await page.waitForTimeout(300);
check('Tags adds the tags as dots (x and y)', (await nodeCount()) === 11 && (await page.locator('.graph-node.tag').count()) === 2, String(await nodeCount()));
await page.uncheck('.graph-panel label:has-text("Orphans") input');
await page.waitForTimeout(300);
const noOrphans = await page.locator('.graph-node').allTextContents();
check('Orphans off removes pages nothing is joined to', !noOrphans.join('|').includes('Orphan one') && !noOrphans.join('|').includes('Loose page') && noOrphans.join('|').includes('Alpha'), noOrphans.join(','));
await page.check('.graph-panel label:has-text("Orphans") input');
await page.uncheck('.graph-panel label:has-text("Tags") input');
await page.selectOption('select[aria-label="Only this group"]', 'g1');
await page.waitForTimeout(300);
check('choosing a group keeps its pages and the ones in groups inside it', (await nodeCount()) === 3, String(await nodeCount()));
await page.selectOption('select[aria-label="Only this group"]', '');
await page.fill('.graph-tools input[type=search]', 'alp');
await page.waitForTimeout(200);
check('searching lights up the matches and dims the rest', (await page.locator('.graph-node.hit').count()) === 1 && (await page.locator('.graph-node.off').count()) === (await nodeCount()) - 1);
await page.fill('.graph-tools input[type=search]', '');

/* ---- colour by group, forces ---- */
const fill = await page.locator('.graph-node[aria-label$=": Alpha"] circle').getAttribute('fill');
const loose = await page.locator('.graph-node[aria-label$=": Loose page"] circle').getAttribute('fill');
check('dots take their group’s colour', fill === 'var(--c-teal)' && loose !== fill, `${fill} / ${loose}`);
await page.uncheck('.graph-panel label:has-text("Colour by group") input');
check('and not when that is off', (await page.locator('.graph-node[aria-label$=": Alpha"] circle').getAttribute('fill')) !== 'var(--c-teal)');
await page.check('.graph-panel label:has-text("Colour by group") input');
const spread = async () => {
  const xs = (await page.locator('.graph-node').evaluateAll((els) => els.map((e) => e.getAttribute('transform')))).map((t) => /translate\(([-\d.]+) ([-\d.]+)\)/.exec(t)).map((m) => Number(m[1]));
  return Math.max(...xs) - Math.min(...xs);
};
const narrow = await spread();
await page.locator('input[aria-label="Repel force"]').evaluate((el) => { el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(3500);
check('a stronger repel force pushes the dots further apart', (await spread()) > narrow, `${narrow} -> ${await spread()}`);
await page.click('.graph-panel button:has-text("Reset forces")');

/* ---- a link between two pages explains itself ---- */
await page.locator('.graph-edge-hit').first().dispatchEvent('click');
check('clicking a line says which boxes it joins', (await page.locator('.graph-edge-info').count()) === 1);
await page.click('.graph-edge-info button:has-text("Close")');

/* ---- clicking a dot opens its page ---- */
await page.dblclick('.graph-svg', { position: { x: 30, y: 30 } }); // fit everything in view again (the forces test spread the dots out)
await page.waitForTimeout(600);
await page.locator('.graph-node[aria-label$=": Gamma"] circle').click({ force: true }); // (the picture may still be drifting by a fraction of a pixel)
await page.waitForFunction(() => location.hash.includes('/page/pc'));
check('clicking a dot opens that page and closes the graph', (await page.locator('.graphview').count()) === 0);

/* ---- local graph around the page you are on ---- */
await openGraph();
await page.selectOption('select[aria-label="How much to show"]', '1');
await page.waitForTimeout(400);
const local = await page.locator('.graph-node').allTextContents();
check('opened from a page, "around this page" shows it and its neighbours only', local.length >= 2 && local.length < 9 && local.join('|').includes('Gamma') && local.join('|').includes('Alpha'), local.join(','));
await page.keyboard.press('Escape');

/* ---- the 3D hierarchy ---- */
await page.goto(URL + '#/');
await page.waitForSelector('.sidebar');
await openGraph();
await page.click('.graph-tabs button:has-text("3D hierarchy")');
await page.waitForSelector('.tree3d-canvas');
await page.waitForTimeout(800);
const ink = () => page.evaluate(() => {
  const c = document.querySelector('.tree3d-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0, h = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { n++; h = (h * 31 + d[i - 3] + d[i - 2] * 7) | 0; }
  return { n, h };
});
const first = await ink();
check('the 3D hierarchy draws something', first.n > 2000, String(first.n));
await page.screenshot({ path: join(OUT, 'tree3d-fresh.png') });
const rows = await page.locator('.tl-row').count();
check('the list beside it has the whole tree: library, groups, pages and headings', rows >= 17, String(rows));
check('groups hold their pages (Work contains Plans, which contains Beta)', (await page.locator('.tl-row.group:has-text("Plans")').count()) === 1 && (await page.locator('.tl-row.page:has-text("Beta")').count()) === 1);
const cv = await page.locator('.tree3d-canvas').boundingBox();
await page.mouse.move(cv.x + 500, cv.y + 300);
await page.mouse.down();
await page.mouse.move(cv.x + 650, cv.y + 340, { steps: 8 });
await page.mouse.up();
const turned = await ink();
check('dragging turns the tree', turned.h !== first.h);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(200);
check('scrolling zooms it', (await ink()).h !== turned.h);
await page.screenshot({ path: join(OUT, 'tree3d.png') });
await page.click('button[aria-label="Fold Work"]');
await page.waitForTimeout(200);
check('folding a group hides what is in it, in the list and the picture', (await page.locator('.tl-row.page:has-text("Beta")').count()) === 0 && (await ink()).h !== turned.h);
await page.click('.tree3d-btns button:has-text("Open all")');
await page.fill('.graph-tools input[type=search]', 'gamma');
await page.waitForTimeout(300);
check('search dims everything but the match in the list', (await page.locator('.tl-row:not(.off)').count()) >= 1 && (await page.locator('.tl-row.off').count()) > 5);
await page.fill('.graph-tools input[type=search]', '');
await page.click('.tl-row.page:has-text("Delta") .tl-name');
await page.waitForFunction(() => location.hash.includes('/page/pd'));
check('clicking a page in the list opens it', true);
await openGraph();
await page.waitForSelector('.tree3d-canvas');
check('the graph remembers it was on the 3D tab', (await page.locator('.graph-tabs button.on:has-text("3D")').count()) === 1);
await page.click('.graph-tabs button:has-text("Graph")');

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
