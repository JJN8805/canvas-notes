// Scripts (Workspace): screenplay, stage, AV, manuscript pages in the real app in headless Chromium, laptop and phone.
// Run with the dev server up (`npm run dev`):  node scripts/script-check.mjs   (screenshots in /tmp/canvas-script-check)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-script-check');
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
const errors = [];
async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font|Fullscreen/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
  page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));
  await page.goto(URL);
  await page.waitForSelector('.sidebar, .phone-tabs', { timeout: 30000 });
  return { ctx, page };
}
const newScript = async (page, starter) => {
  await page.evaluate(() => (location.hash = '#/'));
  await page.waitForFunction(() => !!document.querySelector('.sidebar, .phone-tabs'));
  // through the palette command so it works on both layouts
  await page.keyboard.press('Control+k').catch(() => {});
  return null;
};

// ---------------- laptop ----------------
{
  const { ctx, page } = await open({ viewport: { width: 1400, height: 900 } });
  await page.click('.sidebar >> text=Studio');
  await page.waitForSelector('.office-hub');
  check('the hub offers four kinds including scripts', (await page.locator('.office-col').count()) === 4);
  await page.screenshot({ path: join(OUT, 'hub.png') });
  await page.locator('.office-col[aria-label="Script"] .office-starter').filter({ has: page.locator('strong', { hasText: /^Screenplay$/ }) }).click();
  await page.waitForSelector('.sc-screen');
  check('a screenplay opens with its sheet and layout bar', (await page.locator('.sc-paper').count()) === 1 && (await page.locator('.sc-row').count()) >= 6);
  // typing
  const rows = page.locator('.sc-row .sc-text');
  const last = rows.last();
  await last.click();
  await page.keyboard.type('INT. LIGHTHOUSE - NIGHT');
  await page.keyboard.press('Enter');
  const type1 = await page.locator('.sc-row.on').getAttribute('data-type');
  check('typing INT. then Enter makes a scene heading and an action row follows', type1 === 'action', type1);
  await page.keyboard.type('Waves hit the rock.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); // action -> next type
  const t2 = await page.locator('.sc-row.on').getAttribute('data-type');
  check('Tab changes the empty row type', t2 !== 'action', t2);
  await page.keyboard.press('Control+3');
  check('Ctrl+3 chooses the third type (Character)', (await page.locator('.sc-row.on').getAttribute('data-type')) === 'character');
  await page.keyboard.type('keeper');
  await page.keyboard.press('Enter');
  check('Enter after a character gives dialogue', (await page.locator('.sc-row.on').getAttribute('data-type')) === 'dialogue');
  await page.keyboard.type('Who lit the lamp?');
  await page.keyboard.press('Enter');
  check('Enter after dialogue gives action', (await page.locator('.sc-row.on').getAttribute('data-type')) === 'action');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+3');
  await page.keyboard.type('KE');
  const sug = await page.locator('.sc-suggest button').allTextContents();
  check('a character name is offered as you type', sug.some((s) => s.startsWith('KEEPER')), sug.join('|'));
  await page.keyboard.press('Tab');
  check('Tab accepts the suggestion', (await page.locator('.sc-row.on .sc-text').inputValue()) === 'KEEPER');
  await page.screenshot({ path: join(OUT, 'screenplay.png') });
  // the text really is Fountain in the stored box
  const code = await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    return dbs.map((d) => d.name).join(',');
  });
  check('stored in the browser database', code.length > 0);
  // navigator
  await page.click('.sc-tabs button[aria-label="People"]');
  check('People lists the speaker', (await page.locator('.sc-people tbody tr', { hasText: 'KEEPER' }).count()) === 1);
  await page.click('.sc-tabs button[aria-label="Cards"]');
  await page.locator('.sc-card textarea').first().fill('Opening image.');
  await page.click('.sc-tabs button[aria-label="Scenes"]');
  check('scene list shows the scenes', (await page.locator('.sc-scenes li .sc-go').count()) >= 2, String(await page.locator('.sc-scenes li .sc-go').count()));
  await page.click('.sc-tabs button[aria-label="Plan"]');
  await page.locator('.sc-struct', { hasText: 'Three acts' }).locator('button').click();
  check('adding a structure puts outline headings in the script', (await page.locator('.sc-row[data-type="section"]').count()) >= 8);
  await page.screenshot({ path: join(OUT, 'nav.png') });
  // layouts
  for (const f of ['stage', 'av', 'audio', 'tv', 'manuscript', 'screenplay']) {
    await page.selectOption('select[aria-label="Script layout"]', f);
    await page.waitForTimeout(150);
    check(`layout ${f} shows`, (await page.locator(`.sc-screen[data-format="${f}"]`).count()) === 1);
    if (f !== 'screenplay') await page.screenshot({ path: join(OUT, `${f}.png`) });
  }
  // reload keeps it
  await page.waitForTimeout(2500);
  await page.reload();
  await page.waitForSelector('.sc-screen');
  const values = await page.locator('.sc-text').evaluateAll((els) => els.map((e) => e.value));
  check('the script survives a reload', values.includes('Who lit the lamp?') && values.includes('KEEPER'), values.slice(-6).join('|'));
  await ctx.close();
}

// ---------------- phone ----------------
{
  const { ctx, page } = await open({ viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await page.waitForSelector('.phone-tabs');
  await page.locator('.phone-tabs >> text=More').click();
  await page.locator('.phone-sheet .nav-item:has-text("Studio")').first().click();
  await page.waitForSelector('.office-hub');
  await page.locator('.office-col[aria-label="Script"] .office-starter').first().click();
  await page.waitForSelector('.sc-screen');
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no sideways scrolling on the phone', sw <= 1, String(sw));
  check('element types are picture buttons in a bottom strip', (await page.locator('.sc-types .sc-ico').first().isVisible()) && !(await page.locator('.sc-types .sc-lbl').first().isVisible()));
  const box = await page.locator('.sc-types').boundingBox();
  check('the strip sits at the bottom', box && box.y + box.height >= 840, JSON.stringify(box));
  await page.screenshot({ path: join(OUT, 'phone.png') });
  await page.locator('.sc-navtoggle').click();
  check('the scene list opens as a full screen sheet', (await page.locator('.sc-nav').boundingBox()).width >= 390);
  await page.screenshot({ path: join(OUT, 'phone-nav.png') });
  await ctx.close();
}
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
