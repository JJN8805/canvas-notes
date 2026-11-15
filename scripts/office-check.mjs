// The Workspace add-on: documents, spreadsheets and presentations, in the real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/office-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-office-check');
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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font|Fullscreen/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

await page.goto(URL);
await page.waitForSelector('.sidebar');
check('Workspace is off until switched on: no Workspace entry', (await page.locator('.sidebar >> text=Workspace').count()) === 0);
await page.click('.side-settings');
await page.click('[role=tab]:has-text("Add-ons")');
await page.click('button[role=switch]:has-text("Turn on Workspace")');
await page.waitForSelector('.ai-settings:has-text("Open Workspace")');
await page.keyboard.press('Escape');
await page.click('.sidebar >> text=Workspace');
await page.waitForSelector('.office-hub');
check('the hub offers documents, spreadsheets and presentations', (await page.locator('.office-col').count()) === 3);
await page.screenshot({ path: join(OUT, 'hub.png') });

/* ---------- document ---------- */
await page.click('.office-col[aria-label="Document"] .office-starter:has-text("Report")');
await page.waitForSelector('.doc-paper');
check('a document opens as a sheet of paper, not a canvas', (await page.locator('.doc-paper').count()) === 1 && (await page.locator('.canvas, .world').count()) === 0);
check('the report starter is on the paper', (await page.locator('.doc-paper').innerText()).includes('Summary'));
await page.locator('.doc-paper .ProseMirror').click();
await page.keyboard.press('Control+End');
await page.keyboard.type(' Added words here.');
await page.waitForTimeout(300);
check('the word count follows what is typed', /\d+ words/.test(await page.locator('.doc-status').innerText()));
await page.selectOption('select[aria-label="Paper size"]', 'a4');
check('paper size changes the sheet width', (await page.locator('.doc-paper').evaluate((e) => e.getBoundingClientRect().width)) < 1000);
await page.screenshot({ path: join(OUT, 'doc.png') });
await page.click('.ed-export');
check('a document offers Word, a spreadsheet would not', (await page.locator('.menu >> text=Word document (.docx)').count()) === 1 && (await page.locator('.menu >> text=Excel workbook').count()) === 0);
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.menu >> text=Word document (.docx)')]);
const docPath = join(OUT, 'report.docx');
await dl.saveAs(docPath);
check('the Word file is a real zip named after the page', dl.suggestedFilename() === 'Report.docx' && (await import('node:fs')).readFileSync(docPath).subarray(0, 2).toString() === 'PK');

/* ---------- spreadsheet ---------- */
await page.goto(URL + '#/');
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Workspace');
await page.click('.office-col[aria-label="Spreadsheet"] .office-starter:has-text("Blank spreadsheet")');
await page.waitForSelector('.sheet-table');
const cellAt = (r, c) => page.locator(`td[data-r="${r}"][data-c="${c}"]`);
await cellAt(0, 0).click();
await page.keyboard.type('10');
await page.keyboard.press('Enter');
await page.keyboard.type('20');
await page.keyboard.press('Enter');
await page.keyboard.type('=SUM(A1:A2)');
await page.keyboard.press('Enter');
check('typing in cells fills them and a formula works', (await cellAt(2, 0).innerText()) === '30', await cellAt(2, 0).innerText());
await cellAt(2, 0).click();
check('the formula bar shows the formula', (await page.inputValue('input[aria-label="Formula bar"]')) === '=SUM(A1:A2)');
await cellAt(0, 0).click();
await cellAt(2, 0).click({ modifiers: ['Shift'] });
check('selecting a range shows its sum', (await page.locator('.sheet-status').innerText()).includes('Sum 60'), await page.locator('.sheet-status').innerText());
await page.keyboard.press('Control+b');
check('Ctrl+B makes the selection bold', (await cellAt(1, 0).evaluate((e) => getComputedStyle(e).fontWeight)) === '700');
await page.keyboard.press('Control+z');
check('Ctrl+Z undoes the bold', (await cellAt(1, 0).evaluate((e) => getComputedStyle(e).fontWeight)) !== '700');
await cellAt(0, 0).click();
await page.keyboard.press('Control+ArrowDown');
check('Ctrl+Down jumps to the end of the filled cells', (await cellAt(2, 0).evaluate((e) => e.classList.contains('active'))) === true);
await cellAt(1, 0).click();
await page.keyboard.press('Delete');
check('Delete clears a cell and the formula follows', (await cellAt(2, 0).innerText()) === '10', await cellAt(2, 0).innerText());
await page.click('button[aria-label="Insert row above"]');
check('inserting a row moves the formula down', (await cellAt(3, 0).innerText()) === '10');
await page.waitForTimeout(1500);
await page.reload();
await page.waitForSelector('.sheet-table');
check('the sheet survives a reload', (await cellAt(3, 0).innerText()) === '10');
await page.screenshot({ path: join(OUT, 'sheet.png') });
await page.click('.ed-export');
check('a spreadsheet offers Excel, not Word', (await page.locator('.menu >> text=Excel workbook (.xlsx)').count()) === 1 && (await page.locator('.menu >> text=Word document').count()) === 0);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('.menu >> text=Excel workbook (.xlsx)')]);
const xlsxPath = join(OUT, 'sheet.xlsx');
await dl2.saveAs(xlsxPath);
check('the Excel file is a real zip', dl2.suggestedFilename().endsWith('.xlsx') && (await import('node:fs')).readFileSync(xlsxPath).subarray(0, 2).toString() === 'PK');

/* ---------- presentation ---------- */
await page.goto(URL + '#/');
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Workspace');
await page.click('.office-col[aria-label="Presentation"] .office-starter:has-text("Pitch")');
await page.waitForSelector('.slides-panel');
check('a presentation keeps its canvas and gets a slide list', (await page.locator('.slides-list > li').count()) === 5 && (await page.locator('.world').count()) === 1, (await page.locator('.slides-list > li').count()) + ' slides, ' + (await page.locator('.world').count()) + ' worlds');
await page.click('.slides-head button:has-text("Slide")');
await page.click('.menu >> text=Title and bullets');
await page.waitForFunction(() => document.querySelectorAll('.slides-list > li').length === 6);
check('New slide adds one at the end', true);
await page.click('.slides-list > li:nth-child(6) .slide-thumb');
await page.click('button[aria-label="Move slide up"]');
await page.waitForTimeout(200);
check('a slide can be moved up', (await page.locator('.slides-list > li.on .slide-no').innerText()) === '5');
await page.fill('.slide-notes textarea', 'Say this first');
await page.locator('.slide-notes textarea').blur();
await page.screenshot({ path: join(OUT, 'slides.png') });
await page.click('.slides-head button:has-text("Present")');
await page.waitForSelector('.present');
check('Present shows a slide full screen', (await page.locator('.present .slide-view').count()) === 1 && (await page.locator('.present-count').innerText()).startsWith('5 / 6'));
await page.keyboard.press('n');
check('N shows the speaker notes', (await page.locator('.present-notes').innerText()).includes('Say this first'));
await page.keyboard.press('ArrowRight');
check('the arrow key goes to the next slide', (await page.locator('.present-count').innerText()).startsWith('6 / 6'));
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('Home');
check('Home goes to the first slide', (await page.locator('.present-count').innerText()).startsWith('1 / 6'));
await page.screenshot({ path: join(OUT, 'present.png') });
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.present'));
check('Esc ends the show', true);

/* ---------- switching it off ---------- */
await page.click('.side-settings').catch(async () => { await page.goto(URL + '#/'); await page.click('.side-settings'); });
await page.click('[role=tab]:has-text("Add-ons")');
await page.click('button[role=switch]:has-text("Turn off Workspace")').catch(() => page.click('button[role=switch][aria-checked=true]'));
await page.keyboard.press('Escape');
await page.goBack().catch(() => {});
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
