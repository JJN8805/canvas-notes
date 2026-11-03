// Deeper checks of audio and PDF boxes in headless Chromium against the running dev app (`npm run dev`):
// playback, resizing, reload, duplicate/delete/undo, rejected files, recording (fake microphone), exports,
// search, and an encrypted backup restored into a brand-new browser profile. Prints PASS/FAIL per check.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { tinyPdf, wav } from './fixtures.mjs';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = process.env.MEDIA_OUT ?? join(tmpdir(), 'canvas-media-check');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse())
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) if (existsSync(join(root, d, sub))) return join(root, d, sub);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
};
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const errors = [];
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' ? errors.push(m.text().slice(0, 200)) : 0));
  page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));
  await page.goto(URL);
  await page.waitForSelector('.sidebar');
  return { ctx, page };
};
const pdfDrawn = (page, nth = 0) =>
  page.waitForFunction((n) => {
    const c = document.querySelectorAll('.pdf-body canvas')[n];
    if (!c || !c.width) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) return true;
    return false;
  }, nth, { timeout: 20000 }).then(() => true, () => false);
const download = async (page, trigger, file) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), trigger()]);
  const path = join(OUT, file);
  await dl.saveAs(path);
  return path;
};
const toastText = (page) => page.locator('.toast, [role=status]').allInnerTexts().then((t) => t.join(' | '));

/* ---------- 1. add, play, resize, duplicate, delete, undo, reload ---------- */
let { ctx, page } = await open();
await page.click('text=Open an example page');
await page.waitForSelector('.block');
await page.setInputFiles('input[accept^="application/pdf"]', { name: 'Contract.pdf', mimeType: 'application/pdf', buffer: tinyPdf(['First page', 'Second page']) });
await page.waitForSelector('.pdf-body canvas', { timeout: 20000 });
await page.setInputFiles('input[accept^="audio"]', { name: 'team_standup.wav', mimeType: 'audio/wav', buffer: wav() });
await page.waitForSelector('.audio-body audio');
check('PDF page 1 is really drawn', await pdfDrawn(page));

const strip = await page.locator('.pdf-name').boundingBox();
await page.mouse.move(strip.x + 20, strip.y + 10);
await page.mouse.down();
await page.mouse.move(strip.x + 330, strip.y + 10, { steps: 8 });
await page.mouse.up();

const audioInfo = await page.$eval('.audio-body audio', async (a) => {
  await new Promise((r) => (a.readyState >= 1 ? r() : a.addEventListener('loadedmetadata', r, { once: true })));
  let played = false;
  const t0 = performance.now();
  let startedAfter = null;
  try {
    await a.play();
    // Poll: real playback may take a moment to start (audio device start-up), but it must start.
    while (performance.now() - t0 < 4000 && !(a.currentTime > 0.2 || a.ended)) await new Promise((r) => setTimeout(r, 50));
    played = a.currentTime > 0.2 || a.ended;
    startedAfter = Math.round(performance.now() - t0);
    a.pause();
  } catch (e) { played = String(e); }
  return { duration: a.duration, played, startedAfter, currentTime: a.currentTime, paused: a.paused, readyState: a.readyState, src: a.src.slice(0, 5), error: a.error && a.error.code };
});
check('audio loads from the store (blob URL, no error) and is 1 s long', audioInfo.src === 'blob:' && !audioInfo.error && Math.abs(audioInfo.duration - 1) < 0.2, JSON.stringify(audioInfo));
check('audio really plays (time advances)', audioInfo.played === true, JSON.stringify(audioInfo));
console.log('      playback started after', audioInfo.startedAfter, 'ms');

// Resize: drag the PDF's east handle wider; the page must be redrawn to fit the new width
await page.locator('.block:has(.pdf-body)').click({ position: { x: 60, y: 60 } });
const before = await page.$eval('.pdf-body canvas', (c) => c.getBoundingClientRect().width);
const handle = await page.locator('.block:has(.pdf-body) .resize-e').boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
await page.mouse.down();
await page.mouse.move(handle.x + 160, handle.y + handle.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(600);
const after = await page.$eval('.pdf-body canvas', (c) => c.getBoundingClientRect().width);
check('resizing the PDF box re-fits the page to the new width', after > before + 80, `${before} -> ${after}`);
check('PDF still drawn after resize', await pdfDrawn(page));

// Duplicate, delete, undo
await page.locator('.block:has(.pdf-body)').click({ position: { x: 60, y: 60 } });
await page.keyboard.press('Control+d');
await page.waitForFunction(() => document.querySelectorAll('.pdf-body').length === 2);
check('duplicating gives a second PDF box that also draws', await pdfDrawn(page, 1));
await page.keyboard.press('Delete');
await page.waitForFunction(() => document.querySelectorAll('.pdf-body').length === 1);
await page.keyboard.press('Control+z');
await page.waitForFunction(() => document.querySelectorAll('.pdf-body').length === 2).then(() => check('undo brings the deleted PDF box back', true), () => check('undo brings the deleted PDF box back', false));
await page.keyboard.press('Control+z'); // undo the duplicate
await page.waitForFunction(() => document.querySelectorAll('.pdf-body').length === 1, null, { timeout: 5000 }).catch(() => {});

// Rejected files leave the page as it was and say why
const boxes = () => page.locator('.block').count();
const n0 = await boxes();
await page.setInputFiles('input[accept^="application/pdf"]', { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not a pdf at all') });
await page.waitForSelector('text=can’t be read as a PDF', { timeout: 15000 }).then(() => check('a broken PDF is refused with a reason', true), () => check('a broken PDF is refused with a reason', false, 'no message'));
await page.setInputFiles('input[accept^="audio"]', { name: 'huge.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(26 * 1024 * 1024, 1) });
await page.waitForSelector('text=the limit is 25 MB', { timeout: 15000 }).then(() => check('an over-size audio file is refused with the limit', true), async () => check('an over-size audio file is refused with the limit', false, await toastText(page)));
await page.setInputFiles('input[accept^="audio"]', { name: 'empty.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(0) });
await page.waitForSelector('text=the file is empty', { timeout: 15000 }).then(() => check('an empty audio file is refused', true), () => check('an empty audio file is refused', false));
check('refused files added no boxes', (await boxes()) === n0, `${n0} -> ${await boxes()}`);

// Record with the fake microphone
const recBtn = page.locator('button.tool:has-text("Record")');
check('Record button is offered when the window can record', await recBtn.count() === 1);
await recBtn.click();
await page.waitForSelector('button.tool:has-text("Stop")', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1800);
await page.click('button.tool:has-text("Stop")').catch(() => {});
await page.waitForSelector('.audio-name:has-text("Recording")', { timeout: 15000 }).then(() => check('recording from the microphone adds an audio box', true), async () => check('recording from the microphone adds an audio box', false, await toastText(page)));
const recInfo = await page.$$eval('.audio-body', (els) => els.map((e) => ({ name: e.querySelector('.audio-name')?.textContent, len: e.querySelector('.audio-len')?.textContent })));
console.log('      boxes:', JSON.stringify(recInfo));
check('a fresh recording shows its length (not left blank)', /^\d+:\d\d$/.test(recInfo.find((b) => b.name?.startsWith('Recording'))?.len ?? ''), JSON.stringify(recInfo));

// Reload: everything must come back from storage
await page.waitForTimeout(800); // let the save finish
await page.reload();
await page.waitForSelector('.pdf-body canvas', { timeout: 20000 });
check('after reload the PDF is still there and drawn', await pdfDrawn(page));
const afterReload = await page.$$eval('.audio-body audio', async (els) => Promise.all(els.map(async (a) => {
  await new Promise((r) => (a.readyState >= 1 ? r() : (a.addEventListener('loadedmetadata', r, { once: true }), setTimeout(r, 4000))));
  a.currentTime = 0.5; // scrubbing: a clip without a stored length can't be sought in Chromium
  await new Promise((r) => setTimeout(r, 300));
  return { duration: String(a.duration), seekable: a.seekable.length ? a.seekable.end(a.seekable.length - 1) : 0, moved: Math.abs(a.currentTime - 0.5) < 0.1, error: a.error?.code ?? null };
})));
console.log('      after reload:', JSON.stringify(afterReload));
check('after reload every audio box loads, has a real length and can be scrubbed', afterReload.length >= 2 && afterReload.every((a) => Number.isFinite(Number(a.duration)) && a.moved && !a.error), JSON.stringify(afterReload));

/* ---------- 2. exports ---------- */
const exportAs = (label, file) => download(page, async () => { await page.click('button:has-text("Export")'); await page.click(`[role=menu] button:has-text("${label}")`); }, file);
const zipPath = await exportAs('Markdown', 'page.zip');
const listing = execFileSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print("\\n".join(z.namelist()))', zipPath]).toString().split('\n');
check('Markdown export is a zip with files/ holding the audio and the PDF', listing.some((n) => /^files\/.+\.pdf$/.test(n)) && listing.some((n) => /^files\/.+\.(wav|weba)$/.test(n)), listing.join(', '));
const md = execFileSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);n=[x for x in z.namelist() if x.endswith(".md")][0];print(z.read(n).decode())', zipPath]).toString();
check('the Markdown links both files', /🔊 \[team standup\]\(files\//.test(md) && /📄 \[Contract\]\(files\//.test(md), md.slice(0, 400));
const pdfBytes = execFileSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);n=[x for x in z.namelist() if x.endswith(".pdf")][0];sys.stdout.buffer.write(z.read(n)[:5])', zipPath]);
check('the PDF in the zip is the real, unchanged PDF', pdfBytes.toString() === '%PDF-');
const png = await exportAs('PNG', 'page.png');
const pngHead = readFileSync(png).subarray(0, 8).toString('hex');
check('PNG export works with the new boxes on the page', pngHead === '89504e470d0a1a0a' && readFileSync(png).length > 5000, `${readFileSync(png).length} bytes`);
const pdfOut = await exportAs('PDF', 'page.pdf');
check('PDF export works with the new boxes on the page', readFileSync(pdfOut).subarray(0, 5).toString() === '%PDF-' && readFileSync(pdfOut).length > 5000);

/* ---------- 3. search ---------- */
await page.click('.ed-back');
await page.waitForSelector('.sidebar');
const found = async (q) => { await page.fill('input[aria-label="Search pages"]', q); await page.waitForTimeout(200); return page.locator('.library .main .card, .library .main [class*=pcard], .library .main article').count().then(async (c) => c || (await page.locator('text=No pages match your search').count() ? 0 : -1)); };
check('has:audio finds the page', (await found('has:audio')) > 0);
check('has:pdf finds the page', (await found('has:pdf')) > 0);
check('the PDF is found by its name', (await found('contract')) > 0);
check('a name that is not there finds nothing', (await found('zzznothing')) === 0);
await page.fill('input[aria-label="Search pages"]', '');
await page.screenshot({ path: join(OUT, 'library.png') });

/* ---------- 4. encrypted backup, restored into a brand-new profile ---------- */
await page.click('.side-settings');
await page.click('[role=tab]:has-text("Data")');
const backupPath = await download(page, async () => {
  await page.click('button:has-text("Encrypted backup")');
  await page.locator('input[type=password]').fill('correct horse');
  await page.keyboard.press('Enter');
  await page.locator('input[type=password]').fill('correct horse');
  await page.keyboard.press('Enter');
}, 'backup.json');
const raw = readFileSync(backupPath, 'utf8');
const env = JSON.parse(raw);
check('the backup file is an encrypted envelope', env.format === 'canvas-notes-encrypted-backup' && env.iterations === 600000);
check('no note text, file name or tag is readable in it', !/Welcome|Contract|standup|guide|canvas/i.test(raw.replace(/canvas-notes-encrypted-backup/g, '')));
await ctx.close();

({ ctx, page } = await open());
await page.click('.side-settings');
await page.click('[role=tab]:has-text("Data")');
await page.setInputFiles('input[type=file][accept*="json"]', backupPath);
await page.locator('input[type=password]').fill('wrong one');
await page.keyboard.press('Enter');
await page.waitForSelector('text=Wrong passphrase', { timeout: 15000 }).then(() => check('a wrong passphrase is refused', true), () => check('a wrong passphrase is refused', false));
await page.setInputFiles('input[type=file][accept*="json"]', backupPath);
await page.locator('input[type=password]').fill('correct horse');
await page.keyboard.press('Enter');
await page.click('button.danger:has-text("Restore")');
await page.waitForSelector('text=Restored 1 page', { timeout: 30000 }).then(() => check('the right passphrase restores the page into a fresh profile', true), async () => check('the right passphrase restores the page into a fresh profile', false, await toastText(page)));
await page.keyboard.press('Escape');
await page.click('text=Canvas basics');
await page.waitForSelector('.pdf-body canvas', { timeout: 20000 }).then(() => check('restored page shows its PDF box', true), () => check('restored page shows its PDF box', false));
check('restored PDF is drawn (its file came back with the backup)', await pdfDrawn(page));
const restoredAudio = await page.$$eval('.audio-body audio', async (els) => Promise.all(els.map(async (a) => { await new Promise((r) => (a.readyState >= 1 ? r() : (a.addEventListener('loadedmetadata', r, { once: true }), setTimeout(r, 4000)))); return a.duration > 0; })));
check('restored audio boxes load (their files came back too)', restoredAudio.length >= 2 && restoredAudio.every(Boolean), JSON.stringify(restoredAudio));
await page.screenshot({ path: join(OUT, 'restored.png') });
await ctx.close();

check('no console errors or exceptions in any step', errors.length === 0, errors.slice(0, 4).join(' || '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Files for inspection: ${OUT}`);
process.exit(failed.length ? 1 : 0);
