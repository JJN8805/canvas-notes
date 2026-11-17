// The graph view: one 3D picture that is a live network or a hierarchy, with filters and forces: the real app in headless Chromium, on a seeded library.
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
  await page.waitForSelector('.graphview .tree3d-canvas', { timeout: 6000 }).catch(async (e) => { console.log('ERRORS', errors, await page.locator('.dialog').first().innerText().catch(() => 'no dialog')); await page.screenshot({ path: join(OUT, 'fail.png') }); throw e; });
};
// The picture is a canvas, so the page asks it where things are (`__screen`, see CLAUDE.md).
const screen = () => page.evaluate(() => document.querySelector('.tree3d-canvas').__screen());
const dot = async (label) => (await screen()).nodes.find((n) => n.label === label);
const labels = async () => (await screen()).nodes.map((n) => n.label);
const still = async () => {
  // wait until nothing moves any more: the force layout has cooled and the camera has finished fitting
  let last = '';
  for (let i = 0; i < 60; i++) {
    const s = await screen();
    const now = JSON.stringify(s.nodes.map((n) => [Math.round(n.x), Math.round(n.y)]));
    if (now === last && s.alpha < 0.002) return true;
    last = now;
    await page.waitForTimeout(250);
  }
  return false;
};
const spread = async () => {
  const n = (await screen()).nodes;
  let m = 0;
  for (const a of n) for (const b of n) m = Math.max(m, Math.hypot(a.x - b.x, a.y - b.y));
  return Math.round(m);
};
const ink = () => page.evaluate(() => {
  const c = document.querySelector('.tree3d-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0, h = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { n++; h = (h * 31 + d[i - 3] + d[i - 2] * 7 + d[i - 1] * 13) | 0; }
  return { n, h };
});
const colourAt = (x, y) => page.evaluate(([x, y]) => {
  const c = document.querySelector('.tree3d-canvas');
  const r = c.getBoundingClientRect();
  const k = c.width / r.width;
  return [...c.getContext('2d').getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data].join(',');
}, [x, y]);
const canvasBox = () => page.locator('.tree3d-canvas').boundingBox();

await openGraph();
await page.waitForTimeout(1200);
let sc = await screen();
check('one view: a Network / Hierarchy switch, the settings panel and the list of notes beside the picture', (await page.locator('.graph-tabs button[aria-pressed="true"]').innerText()) === 'Network' && (await page.locator('.graph-panel').count()) === 1 && (await page.locator('.tl-row').count()) >= 14);
check('it opens as a network that holds the library, its groups and every page and card', sc.layout === 'network' && ['Library', 'Work', 'Plans', 'Home', 'Cards', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Loose page', 'Orphan one', 'Orphan two', 'A card'].every((l) => sc.nodes.some((n) => n.label === l)), (await labels()).join(','));
check('grey lines join each to what it belongs to, and links join pages: text, box and the card’s', sc.hierarchyLines >= 12 && sc.edges.length === 4, `${sc.hierarchyLines} lines, ${sc.edges.length} links`);

/* ---- it settles by itself, and holds still ---- */
check('it settles: the live layout cools and then holds still', await still());
await page.screenshot({ path: join(OUT, 'graph.png') });

/* ---- dragging a dot pulls it (and does not open it) ---- */
const alpha0 = await dot('Alpha');
const box = await canvasBox();
await page.mouse.move(alpha0.x, alpha0.y);
await page.mouse.down();
const target = { x: Math.min(box.x + box.width - 60, alpha0.x + 150), y: Math.max(box.y + 80, alpha0.y - 120) };
await page.mouse.move(target.x, target.y, { steps: 10 });
await page.waitForTimeout(150);
const held = await dot('Alpha');
check('dragging a dot pulls it along with the pointer', Math.hypot(held.x - target.x, held.y - target.y) < 25, `${Math.round(held.x)},${Math.round(held.y)} vs ${target.x},${target.y}`);
await page.mouse.up();
check('and does not open the page', (await page.locator('.graphview').count()) === 1 && !(await page.evaluate(() => location.hash)).includes('/page/'));
check('the rest follow it and settle again', await still());

/* ---- zoom, turn, fit ---- */
const sp0 = await spread();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -500);
await page.waitForTimeout(250);
check('scrolling zooms in', (await spread()) > sp0, `${sp0} -> ${await spread()}`);
const inked = await ink();
await page.mouse.move(box.x + 700, box.y + 600);
await page.mouse.down();
await page.mouse.move(box.x + 560, box.y + 560, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
check('dragging the background turns the picture', (await ink()).h !== inked.h);

/* ---- forces ---- */
await page.click('.graph-panel button:has-text("Reset forces")');
await still();
const narrow = await spread();
await page.locator('input[aria-label="Repel force"]').fill('4');
await page.waitForTimeout(3500);
check('a stronger repel force pushes the dots further apart', (await spread()) > narrow, `${narrow} -> ${await spread()}`);
await page.click('.graph-panel button:has-text("Reset forces")');
await page.dblclick('.tree3d-canvas', { position: { x: 30, y: 30 } }); // fit again
await still();
await page.screenshot({ path: join(OUT, 'graph-fit.png') });

/* ---- colours: a page takes its group's colour ---- */
const alpha1 = await dot('Alpha');
const coloured = await colourAt(alpha1.x, alpha1.y);
await page.uncheck('.graph-panel >> text=Colour by group');
await page.waitForTimeout(300);
const plain = await colourAt(alpha1.x, alpha1.y);
check('dots take their group’s colour, and not when that is off', coloured !== plain, `${coloured} vs ${plain}`);
await page.check('.graph-panel >> text=Colour by group');

/* ---- filters ---- */
await page.check('.graph-panel >> text=Tags');
await page.waitForTimeout(500);
check('Tags adds the tags as dots, joined to what uses them', ['#x', '#y'].every((t) => labels().then((l) => l.includes(t))) && (await screen()).edges.filter((e) => e.kind === 'tag').length === 5, String((await screen()).edges.length));
await page.uncheck('.graph-panel >> text=Tags');
await page.uncheck('.graph-panel >> text=Orphans');
await page.waitForTimeout(400);
check('Orphans off removes pages nothing is joined to (and groups left empty)', !(await labels()).includes('Orphan one') && !(await labels()).includes('Loose page') && (await labels()).includes('Alpha'), (await labels()).join(','));
await page.check('.graph-panel >> text=Orphans');
await page.selectOption('select[aria-label="Only this group"]', { label: 'Home' });
await page.waitForTimeout(400);
let l = await labels();
check('choosing a group keeps its pages only', l.includes('Delta') && l.includes('Epsilon') && !l.includes('Alpha') && !l.includes('Beta'), l.join(','));
await page.selectOption('select[aria-label="Only this group"]', '');
await page.selectOption('select[aria-label="Only this tag"]', 'x');
await page.waitForTimeout(400);
l = await labels();
check('choosing a tag keeps what carries it', l.includes('Alpha') && l.includes('Beta') && !l.includes('Gamma'), l.join(','));
await page.selectOption('select[aria-label="Only this tag"]', '');
await page.uncheck('.graph-panel >> text=Cards');
await page.waitForTimeout(300);
check('Cards off removes the cards', !(await labels()).includes('A card'));
await page.check('.graph-panel >> text=Cards');
await page.uncheck('.graph-panel >> text=Box links');
await page.waitForTimeout(300);
check('Box links off removes those lines', (await screen()).edges.every((e) => e.kind !== 'box'));
await page.check('.graph-panel >> text=Box links');
await page.check('.graph-panel >> text=Headings under pages');
await page.waitForTimeout(500);
check('headings can hang under their pages', (await labels()).includes('Intro') && (await labels()).includes('Detail'));
await page.uncheck('.graph-panel >> text=Headings under pages');

/* ---- the network without the hierarchy is the plain graph ---- */
await page.uncheck('.graph-panel >> text=Library and groups');
await page.waitForTimeout(500);
sc = await screen();
check('with "Library and groups" off only pages, cards and tags remain, and no grey lines', sc.hierarchyLines === 0 && sc.nodes.every((n) => ['page', 'card', 'tag'].includes(n.kind)) && sc.nodes.length === 9, `${sc.nodes.length}`);
await page.check('.graph-panel >> text=Library and groups');
await page.waitForTimeout(500);

/* ---- search ---- */
await page.fill('input[aria-label="Find in the graph"]', 'gamma');
await page.waitForTimeout(300);
check('searching dims the notes that do not match, in the list too', (await page.locator('.tl-row.off').count()) >= 5 && (await page.locator('.tl-row.tl-page:not(.off):has-text("Gamma")').count()) === 1);
await page.fill('input[aria-label="Find in the graph"]', '');

/* ---- a link explains itself ---- */
await still();
const edge = (await screen()).edges.find((e) => e.kind === 'box');
await page.mouse.click(edge.x, edge.y);
await page.waitForSelector('.graph-edge-info', { timeout: 3000 }).catch(() => {});
check('clicking a line says which boxes it joins', (await page.locator('.graph-edge-info').count()) === 1 && /Alpha/.test(await page.locator('.graph-edge-info').innerText()) && /Gamma/.test(await page.locator('.graph-edge-info').innerText()));
await page.click('.graph-edge-info button:has-text("Close")');

/* ---- the hierarchy: the same dots, laid out as a tree ---- */
const before = await screen();
await page.click('.graph-tabs button:has-text("Hierarchy")');
await page.waitForTimeout(1500);
sc = await screen();
check('Hierarchy lays the same dots out as a tree: the library on top, groups below it, pages below those', sc.layout === 'tree' && sc.nodes.length === before.nodes.length, `${sc.nodes.length} vs ${before.nodes.length}`);
const y = (label) => sc.nodes.find((n) => n.label === label).y;
check('each level is lower than the one above', y('Library') < y('Work') && y('Work') < y('Plans') && y('Plans') < y('Beta'), [y('Library'), y('Work'), y('Plans'), y('Beta')].join(' < '));
check('no two dots sit on top of each other', new Set(sc.nodes.map((n) => `${Math.round(n.x / 3)},${Math.round(n.y / 3)}`)).size === sc.nodes.length);
check('the links are still there, and the forces are not offered', sc.edges.length === 4 && (await page.locator('input[aria-label="Repel force"]').count()) === 0);
check('"Library and groups" is locked on', await page.locator('.graph-panel label:has-text("Library and groups") input').isDisabled());
await page.screenshot({ path: join(OUT, 'tree3d.png') });
const treeInk = await ink();
await page.mouse.move(box.x + 700, box.y + 600);
await page.mouse.down();
await page.mouse.move(box.x + 560, box.y + 560, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
check('the hierarchy turns too', (await ink()).h !== treeInk.h);
await page.click('button[aria-label="Fold Work"]');
await page.waitForTimeout(500);
l = await labels();
check('folding a group hides what is in it, in the picture and the list', !l.includes('Alpha') && !l.includes('Plans') && l.includes('Work') && (await page.locator('.tl-row.tl-page:has-text("Alpha")').count()) === 0, l.join(','));
await page.click('.tree3d-btns button:has-text("Open all")');
await page.waitForTimeout(500);
check('Open all brings it back', (await labels()).includes('Alpha'));

/* ---- and back to the network, which remembers where it was ---- */
await page.click('.graph-tabs button:has-text("Network")');
await page.waitForTimeout(1200);
await still();
sc = await screen();
check('Network again: the force layout, the forces are back, nothing overlaps', sc.layout === 'network' && (await page.locator('input[aria-label="Repel force"]').count()) === 1 && new Set(sc.nodes.map((n) => `${Math.round(n.x / 3)},${Math.round(n.y / 3)}`)).size === sc.nodes.length);

/* ---- the list opens things ---- */
await page.click('.tl-row.tl-page:has-text("Beta") .tl-name');
await page.waitForFunction(() => location.hash.includes('/page/pb'));
check('clicking a page in the list opens it and closes the graph', (await page.locator('.graphview').count()) === 0);

/* ---- clicking a dot opens its page ---- */
await openGraph();
await page.waitForTimeout(500);
await still();
const gamma = await dot('Gamma');
await page.mouse.click(gamma.x, gamma.y);
await page.waitForFunction(() => location.hash.includes('/page/pc'), null, { timeout: 5000 }).catch(() => {});
check('clicking a dot opens that page and closes the graph', (await page.evaluate(() => location.hash)).includes('/page/pc') && (await page.locator('.graphview').count()) === 0, await page.evaluate(() => location.hash));

/* ---- local graph around the page you are on ---- */
await openGraph();
await page.selectOption('select[aria-label="How much to show"]', '1');
await page.waitForTimeout(500);
l = await labels();
check('opened from a page, "around this page" shows it and what it touches only', l.includes('Gamma') && l.includes('Alpha') && !l.includes('Epsilon') && !l.includes('Orphan one'), l.join(','));
await page.keyboard.press('Escape');

/* ---- the layout is remembered ---- */
await page.goto(URL + '#/');
await page.waitForSelector('.sidebar');
await openGraph();
await page.click('.graph-tabs button:has-text("Hierarchy")');
await page.keyboard.press('Escape');
await openGraph();
check('the graph remembers it was on Hierarchy', (await page.locator('.tree3d-canvas').getAttribute('data-layout')) === 'tree');
await page.click('.graph-tabs button:has-text("Network")');

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
