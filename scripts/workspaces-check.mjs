// Workspaces: make one from the switcher, see pages stay apart, move a page across, link across, delete a workspace.
// Run with the dev server up (`npm run dev`):  node scripts/workspaces-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-workspaces-check');
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
// Two pages in Main (one will get a link), one page in a workspace that already exists (as if made on another device).
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('canvas-notes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const now = Date.now();
  const mk = (id, title, extra = {}) => ({ id, etag: 'e' + id, synced: null, deleted: false, title, groupId: null, tags: [], blocks: [], arrows: [], drawing: null, color: null, kind: 'page', dailyDate: null, sheet: null, created: now, updated: now, rev: 1, ...extra });
  const tx = db.transaction(['pages', 'groups'], 'readwrite');
  tx.objectStore('pages').put(mk('pm1', 'Lecture notes'));
  tx.objectStore('pages').put(mk('pm2', 'Essay plan'));
  tx.objectStore('pages').put(mk('pc1', 'Video script', { workspace: 'wcreator' }));
  tx.objectStore('groups').put({ id: 'wcreator', name: 'Content creator', color: 'plum', position: 0, parentId: null, scope: 'workspaces', etag: 'ew', synced: null, deleted: false });
  await new Promise((res) => (tx.oncomplete = res));
  db.close();
});
await page.reload();
await page.waitForSelector('.sidebar');
await page.waitForTimeout(800);

const titles = async () => (await page.locator('.card h3, .card .card-title').allInnerTexts()).map((t) => t.trim());
const hasCard = async (t) => (await page.locator(`.card:has-text("${t}")`).count()) > 0;

/* ---- the switcher ---- */
check('the sidebar shows the open workspace (Main)', /Main/.test(await page.locator('.ws-side').innerText()));
check('Main shows its own pages and not the other workspace’s', (await hasCard('Lecture notes')) && (await hasCard('Essay plan')) && !(await hasCard('Video script')));
await page.screenshot({ path: join(OUT, '1-main.png') });
await page.click('.ws-side');
await page.waitForSelector('.menu');
const menuText = await page.locator('.menu').innerText();
check('the menu lists both workspaces with their page counts', /Main[\s\S]*2[\s\S]*Content creator[\s\S]*1/.test(menuText), menuText);
await page.screenshot({ path: join(OUT, '2-menu.png') });
await page.click('.menu-item:has-text("Content creator")');
await page.waitForTimeout(600);
check('switching shows the other workspace’s pages only', (await hasCard('Video script')) && !(await hasCard('Lecture notes')));
check('and the sidebar names it', /Content creator/.test(await page.locator('.ws-side').innerText()));
check('the choice is remembered on reload', await (async () => { await page.reload(); await page.waitForSelector('.sidebar'); await page.waitForTimeout(600); return /Content creator/.test(await page.locator('.ws-side').innerText()) && (await hasCard('Video script')); })());

/* ---- a new workspace from the menu ---- */
await page.click('.ws-side');
await page.click('.menu-item:has-text("New workspace")');
await page.waitForSelector('.dialog input');
await page.fill('.dialog input', 'Student');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
check('a new workspace opens, empty', /Student/.test(await page.locator('.ws-side').innerText()) && !(await hasCard('Video script')) && !(await hasCard('Lecture notes')));
await page.screenshot({ path: join(OUT, '3-student-empty.png') });

/* ---- move a page across ---- */
await page.click('.ws-side');
await page.click('.menu-item:has-text("Main")');
await page.waitForTimeout(500);
await page.locator('.card:has-text("Essay plan") [aria-label^="Options for"]').click();
await page.waitForSelector('.menu');
check('the page menu offers Move to / Copy to the other workspaces', (await page.locator('.menu-item:has-text("Move to Student")').count()) === 1 && (await page.locator('.menu-item:has-text("Copy to Student")').count()) === 1);
await page.click('.menu-item:has-text("Move to Student")');
await page.waitForTimeout(600);
check('the moved page has left Main', !(await hasCard('Essay plan')) && (await hasCard('Lecture notes')));
check('and a message with Undo says where it went', /Student/.test(await page.locator('.toast, [role=status]').first().innerText().catch(() => '')));
await page.click('.ws-side');
await page.click('.menu-item:has-text("Student")');
await page.waitForTimeout(500);
check('it is in Student', await hasCard('Essay plan'));

/* ---- copy back ---- */
await page.locator('.card:has-text("Essay plan") [aria-label^="Options for"]').click();
await page.click('.menu-item:has-text("Copy to Main")');
await page.waitForTimeout(600);
check('copying leaves the original here', await hasCard('Essay plan'));
await page.click('.ws-side');
await page.click('.menu-item:has-text("Main")');
await page.waitForTimeout(500);
check('and puts a copy in the other workspace', await hasCard('Essay plan'));

/* ---- delete a workspace: pages go to Main ---- */
await page.click('.ws-side');
await page.click('.menu-item:has-text("Student")');
await page.waitForTimeout(400);
await page.click('.ws-side');
await page.click('.menu-item:has-text("Delete this workspace")');
await page.waitForSelector('.dialog');
await page.click('.dialog button:has-text("Delete workspace")');
await page.waitForTimeout(800);
check('deleting a workspace opens Main', /Main/.test(await page.locator('.ws-side').innerText()));
check('its page is in Main (nothing lost)', (await page.locator('.card:has-text("Essay plan")').count()) === 2);
await page.screenshot({ path: join(OUT, '4-after-delete.png') });

/* ---- palette ---- */
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette');
await page.keyboard.press('Control+p').catch(() => {});
await page.keyboard.press('Escape');

check('no console errors', errors.length === 0, errors.join(' | '));
console.log('screenshots in', OUT);
await browser.close();
process.exit(failed ? 1 : 0);
