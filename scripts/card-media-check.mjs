// Cards can hold pictures, GIFs and videos: a real animated GIF and a real WebM are set as a card's picture in the app (headless Chromium).
// Run with the dev server up:  node scripts/card-media-check.mjs   (needs /tmp/anim.gif: made by the script below if Pillow is there)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-card-media-check');
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

/* ---- the two files: a 3-frame animated GIF (written here, byte for byte) and a short WebM (recorded by the browser itself) ---- */
const gifPath = join(OUT, 'anim.gif');
// GIF89a, 2x2, 3 frames (red, green, blue), looping
const gif = Buffer.from('R0lGODlhAgACAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAgAAACwAAAAAAgACAAACAkQBACH5BAACAAAALAAAAAACAAIAgAD/AAAAAAIChEwAIfkEAAIAAAAsAAAAAAIAAgCAAAD/AAAAAgKETAA7', 'base64');
writeFileSync(gifPath, gif);
// The browser records a short WebM of a colour-cycling canvas (MediaRecorder), so the test needs no video tools.
const rec = await (await browser.newContext()).newPage();
await rec.setContent('<canvas id=c width=320 height=240></canvas>');
const b64 = await rec.evaluate(async () => {
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  const mr = new MediaRecorder(c.captureStream(20), { mimeType: 'video/webm' });
  const parts = [];
  mr.ondataavailable = (e) => parts.push(e.data);
  const stopped = new Promise((r) => (mr.onstop = r));
  mr.start(100);
  let i = 0;
  const t = setInterval(() => { g.fillStyle = ['#e33', '#3a3', '#36e'][i++ % 3]; g.fillRect(0, 0, 320, 240); }, 60);
  await new Promise((r) => setTimeout(r, 1800));
  clearInterval(t);
  mr.stop();
  await stopped;
  const buf = new Uint8Array(await new Blob(parts, { type: 'video/webm' }).arrayBuffer());
  let s = '';
  for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode(...buf.subarray(k, k + 0x8000));
  return btoa(s);
});
const webm = join(OUT, 'clip.webm');
writeFileSync(webm, Buffer.from(b64, 'base64'));
console.log('clip.webm', Buffer.from(b64, 'base64').length, 'bytes');

const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));
await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('.nav-item:has-text("Cards")');
await page.click('.cf-main button:has-text("New card"), main button:has-text("New card")');
await page.waitForSelector('.cd-label');
await page.fill('.cd-label', 'Moving things');
const fileInput = page.locator('.cd-cover input[type=file]');
check('the card picture button says pictures, GIFs and videos', /GIF or video/.test(await page.locator('.cd-cover-actions .btn').first().innerText()));
check('and the file chooser accepts videos as well as pictures', /image\/\*/.test(await fileInput.getAttribute('accept')) && /video\/mp4/.test(await fileInput.getAttribute('accept')));

/* ---- a GIF ---- */
await fileInput.setInputFiles(gifPath);
await page.waitForSelector('.cd-cover img');
check('a GIF is shown as a picture (it animates by itself)', (await page.locator('.cd-cover img').count()) === 1 && (await page.locator('.cd-cover video').count()) === 0);
const stored = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('canvas-notes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const names = [...db.objectStoreNames];
  const all = await new Promise((res) => { const tx = db.transaction(['blobs'].filter((n) => names.includes(n)), 'readonly'); const rq = tx.objectStore('blobs').getAll(); rq.onsuccess = () => res(rq.result); });
  return all.map((b) => ({ type: b.blob?.type ?? b.mime, size: b.blob?.size ?? b.size }));
});
check('the GIF is stored as it is (type image/gif, not re-encoded)', stored.some((s) => s.type === 'image/gif'), JSON.stringify(stored));

/* ---- a video replaces it ---- */
await fileInput.setInputFiles(webm);
await page.waitForSelector('.cd-cover video', { timeout: 20000 });
check('a video replaces the picture, as a video with controls', (await page.locator('.cd-cover video[controls]').count()) === 1 && (await page.locator('.cd-cover img').count()) === 0);
await page.waitForFunction(() => document.querySelector('.cd-cover video')?.readyState >= 1);
const dims = await page.locator('.cd-cover video').evaluate((v) => [v.videoWidth, v.videoHeight, v.duration > 0]);
check('it is a real playable video (size and length known)', dims[0] === 320 && dims[1] === 240 && dims[2], JSON.stringify(dims));
await page.screenshot({ path: join(OUT, 'detail-video.png') });
check('the picture is stored as a video type', (await page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('canvas-notes'); r.onsuccess = () => res(r.result); });
  const all = await new Promise((res) => { const rq = db.transaction(['blobs'], 'readonly').objectStore('blobs').getAll(); rq.onsuccess = () => res(rq.result); });
  return all.map((b) => b.blob?.type ?? b.mime);
})).some((t) => /^video\//.test(t)));

/* ---- a wrong file is refused with a reason ---- */
const txt = join(OUT, 'notes.txt');
writeFileSync(txt, 'not a picture');
await page.evaluate(() => (document.querySelector('.cd-cover input[type=file]').accept = ''));
await fileInput.setInputFiles(txt);
await page.waitForTimeout(500);
check('a file that is not a picture or video is refused, and the video stays', (await page.locator('.cd-cover video').count()) === 1 && /picture|GIF|video/i.test(await page.locator('.dialog').innerText()));

/* ---- the gallery tile ---- */
await page.click('.cd-actions button:has-text("Done")');
await page.waitForSelector('.ctile video');
check('the gallery tile shows the video (first frame)', (await page.locator('.ctile-cover video').count()) === 1);
const tile = page.locator('.ctile').first();
await tile.hover();
await page.waitForTimeout(700);
check('and it plays while the pointer is over it', await page.locator('.ctile-cover video').evaluate((v) => !v.paused));
await page.mouse.move(5, 5);
await page.waitForTimeout(300);
check('and stops when the pointer leaves', await page.locator('.ctile-cover video').evaluate((v) => v.paused));
await page.screenshot({ path: join(OUT, 'gallery-video.png') });

/* ---- it is saved ---- */
await page.waitForFunction(() => /Saved|saved/.test(document.body.innerText) || true);
await page.waitForTimeout(1500);
await page.reload();
await page.waitForSelector('.sidebar');
await page.click('.nav-item:has-text("Cards")');
await page.waitForSelector('.ctile video', { timeout: 20000 });
check('after a reload the card still shows its video', (await page.locator('.ctile-cover video').count()) === 1);

/* ---- a card on a page ---- */
check('no console errors', errors.length === 0, errors.join(' | '));
console.log('screenshots in', OUT);
await browser.close();
process.exit(failed ? 1 : 0);
