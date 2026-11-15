// Switching features off: what is left on screen, and that it survives a reload. The real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/features-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-features-check');
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

const nav = async () => (await page.locator('.sidebar .side-section .nav-item').allInnerTexts()).map((t) => t.replace(/\s*\d+$/, '').trim());
const openFeatures = async () => {
  await page.click('.side-settings');
  await page.click('[role=tab]:has-text("Features")');
};
const closeSettings = () => page.keyboard.press('Escape');

await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.waitForSelector('.sidebar >> text=Workspace', { timeout: 30000 });
const before = await nav();
check('everything is on at the start', ['Workspace', 'Journal', 'All pages', 'Groups', 'Tags', 'Cards', 'Templates', 'Trash'].every((n) => before.includes(n)), before.join(', '));

/* ---- Word and Excel only ---- */
await openFeatures();
await page.click('[role=radio]:has-text("Word and Excel only")');
await page.waitForFunction(() => document.querySelector('[role=radio][aria-checked=true]')?.textContent?.includes('Word and Excel only'));
check('the chosen set is shown as selected', true);
check('the Sync and Desktop tabs are gone', (await page.locator('[role=tab]:has-text("Sync")').count()) === 0 && (await page.locator('[role=tab]:has-text("Desktop")').count()) === 0);
await page.screenshot({ path: join(OUT, 'features-tab.png') });
await closeSettings();
await page.waitForTimeout(300);
const only = await nav();
check('the sidebar keeps only Workspace, All pages and Trash', JSON.stringify(only.sort()) === JSON.stringify(['All pages', 'Trash', 'Workspace']), only.join(', '));
await page.click('.sidebar >> text=Workspace');
await page.waitForSelector('.office-hub');
check('the hub offers documents and spreadsheets, not presentations', (await page.locator('.office-col').count()) === 2 && (await page.locator('.office-col[aria-label="Presentation"]').count()) === 0);
await page.screenshot({ path: join(OUT, 'workspace-only.png') });
await page.click('.sidebar >> text=All pages');
check('New page now says New…, and opens Workspace', (await page.locator('button.btn.primary:has-text("New…")').count()) === 1);
await page.click('button.btn.primary:has-text("New…")');
await page.waitForSelector('.office-hub');
check('so a new page starts from Workspace, with no canvas template picker', (await page.locator('.picker').count()) === 0);

// the palette leaves out what is off
await page.keyboard.press('Control+p');
await page.waitForSelector('.palette');
await page.fill('.palette input', 'graph');
check('the palette does not offer the graph view', (await page.locator('.palette-row:has-text("graph view")').count()) === 0);
await page.fill('.palette input', 'card');
check('or cards', (await page.locator('.palette-row:has-text("card")').count()) === 0);
await page.fill('.palette input', 'new document');
check('but it offers a new document', (await page.locator('.palette-row:has-text("New document")').count()) === 1);
await page.fill('.palette input', 'new presentation');
check('and not a new presentation', (await page.locator('.palette-row:has-text("New presentation")').count()) === 0);
await page.keyboard.press('Escape');

// a document's header has no group, tags, links, template or page-size controls
await page.click('.office-col[aria-label="Document"] .office-starter:has-text("Report")');
await page.waitForSelector('.doc-paper');
const header = await page.locator('.editor header, .ed-header').first().innerText().catch(() => '');
check('a document shows no group, tag, template or page-size controls', (await page.locator('.ed-group, .tags-ed, .ed-template, .ed-size, .ed-backlinks').count()) === 0, header.replace(/\n/g, ' | '));
check('but still has Outline, History and Export', (await page.locator('.ed-outline, .ed-history, .ed-export').count()) === 3);
await page.screenshot({ path: join(OUT, 'document-only.png') });

// it all survives a reload
await page.waitForTimeout(800);
await page.reload();
await page.waitForSelector('.doc-paper', { timeout: 60000 });
await page.click('.ed-back');
await page.waitForSelector('.sidebar');
const after = await nav();
check('the choice survives a reload', JSON.stringify(after.sort()) === JSON.stringify(['All pages', 'Trash', 'Workspace']), after.join(', '));

/* ---- back to everything, then one switch ---- */
await openFeatures();
await page.click('[role=radio]:has-text("Everything")');
await closeSettings();
await page.waitForTimeout(300);
check('Everything brings it all back', (await nav()).includes('Journal') && (await nav()).includes('Cards'));
await openFeatures();
await page.click('button[role=switch]:has-text("Journal")');
await page.waitForSelector('text=Your own mix of features');
check('one switch makes it a custom mix', true);
await closeSettings();
await page.waitForTimeout(300);
const mix = await nav();
check('only the Journal went', !mix.includes('Journal') && mix.includes('Cards') && mix.includes('Workspace'), mix.join(', '));

// graph depends on links
await openFeatures();
await page.click('button[role=switch]:has-text("Journal")'); // back on
await page.click('button[role=switch]:has-text("Links")');
await closeSettings();
await page.keyboard.press('Control+p');
await page.fill('.palette input', 'graph');
check('with Links off the graph goes too (it needs them)', (await page.locator('.palette-row:has-text("graph view")').count()) === 0);
await page.keyboard.press('Escape');

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
