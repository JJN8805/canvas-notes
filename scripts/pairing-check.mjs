// One pairing link for sync: shown (text and QR) on the laptop panel, pasted into the phone panel.
// Run with the dev server up (`npm run dev`):  node scripts/pairing-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-pairing-check');
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



const CODE = 'ABCD-EFGH-JKLM-NPQR-STUV';
const setSync = (patch) => page.evaluate(async (p) => { const m = await import('/src/sync/controller.ts'); m.useSync.setState(p); }, patch);

/* ---- laptop side ---- */
await setSync({ platform: 'desktop', panelOpen: true, serverOn: true, addresses: ['10.0.0.5'], code: CODE });
await page.waitForSelector('.pair-link');
const text = await page.locator('.pair-text').innerText();
check('the laptop panel shows the pairing link with its address and code', text === `canvasnotes://pair?a=10.0.0.5&c=${CODE}`, text);
await page.waitForSelector('.pair-qr img');
check('and a QR code of it', await page.locator('.pair-qr img').evaluate((i) => i.complete && i.naturalWidth > 50 && i.src.startsWith('data:image/')));
await page.screenshot({ path: join(OUT, 'laptop.png') });

/* ---- phone side ---- */
await setSync({ platform: 'mobile', panelOpen: true, connected: false, serverOn: false });
await page.waitForSelector('#sync-link');
await page.fill('#sync-link', text);
check('pasting the link fills in the address and the code', (await page.inputValue('#sync-address')) === '10.0.0.5' && (await page.inputValue('#sync-code')) === CODE);
check('and says so', /Link read/.test(await page.locator('.sync-panel').innerText()));
await page.fill('#sync-link', 'hello there');
check('a text that is not a pairing is called out (the manual boxes still work)', /doesn’t look like/.test(await page.locator('.sync-panel').innerText()));
await page.fill('#sync-link', '10.9.9.9 wxyz-1234-abcd-5678-qrst');
check('an address and a code pasted together also work', (await page.inputValue('#sync-address')) === '10.9.9.9' && (await page.inputValue('#sync-code')) === 'WXYZ-1234-ABCD-5678-QRST');
await page.screenshot({ path: join(OUT, 'phone.png') });
const real = errors.filter((e) => !/reading 'invoke'/.test(e)); // the Tauri bridge a browser does not have: only because this check forces the laptop panel
check('no console errors', real.length === 0, real.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
