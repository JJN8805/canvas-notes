// Cards filed under page groups from before card folders: the banner, the one-click move, page groups left alone.
// Run with the dev server up (`npm run dev`):  node scripts/card-legacy-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-legacy-check');
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

await page.goto(URL);
await page.waitForSelector('.sidebar');
// an old-style page group, with a card filed under it (as the app used to do)
await page.click('.sidebar >> text=Groups');
await page.click('button:has-text("New group")');
await page.fill('.dialog input', 'Work');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf');
await page.click('.cf-main button:has-text("New card")');
await page.waitForSelector('.cd-label');
await page.fill('.cd-label', 'Old card');
await page.click('.card-detail button:has-text("Done")');
await page.waitForTimeout(800);
const planted = await page.evaluate(async () => {
  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  const db = await req(indexedDB.open('canvas-notes'));
  const tx = db.transaction(['pages', 'groups'], 'readwrite');
  const groups = await req(tx.objectStore('groups').getAll());
  const pages = await req(tx.objectStore('pages').getAll());
  const g = groups.find((x) => x.name === 'Work' && !x.scope);
  const p = pages.find((x) => x.kind === 'card' && x.title === 'Old card');
  if (!g || !p) return `missing: group ${!!g}, card ${!!p}`;
  await req(tx.objectStore('pages').put({ ...p, groupId: g.id }));
  await new Promise((res) => (tx.oncomplete = res));
  db.close();
  return 'ok';
});
check('an old-style card was planted under the page group', planted === 'ok', planted);
await page.reload();
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf');
const banner = page.locator('.cf-legacy');
check('the banner offers to bring it into card folders', (await banner.count()) === 1 && /1 card is still filed under page groups/.test(await banner.innerText()), await banner.allInnerTexts().then((t) => t.join('|')));
check('meanwhile the card shows at the top, not in a folder', (await page.locator('.cf-main .ctile').count()) === 1);
await page.screenshot({ path: join(OUT, '1-banner.png') });
await page.click('.cf-legacy button');
await page.waitForTimeout(400);
check('the banner goes away', (await page.locator('.cf-legacy').count()) === 0);
check('a folder named Work now exists in the tree, with the card', /Work/.test(await page.locator('.cf-tree').innerText()) && (await page.locator('.cf-tree .cf-row', { hasText: 'Work' }).innerText()).includes('1'));
check('and the card is no longer loose: it sits in the Work section', (await page.locator('.cf-main > .cgrid .ctile').count()) === 0 && (await page.locator('.section:has(> .section-head:has-text("Work")) .ctile').count()) === 1);
await page.screenshot({ path: join(OUT, '2-moved.png') });
await page.waitForTimeout(1500); // saves are batched for a moment
await page.reload();
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Cards');
await page.waitForSelector('.cf');
check('after a reload it stays that way', (await page.locator('.cf-legacy').count()) === 0 && /Work/.test(await page.locator('.cf-tree').innerText()));
await page.click('.sidebar >> text=Groups');
await page.waitForTimeout(300);
check('the page group Work is still there, untouched', /Work/.test(await page.locator('.main').innerText()));
check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
