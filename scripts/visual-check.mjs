// Opens the running dev app (`npm run dev`) in headless Chromium, walks through every main screen with sample data,
// saves a screenshot of each to .visual/, and fails on any console error, failed request or uncaught exception.
// Read the screenshots afterwards: this catches what the type checker and the tests cannot.
//   npm run dev        (in one terminal)
//   npm run visual     (in another; set APP_URL for a different address)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tinyPdf, wav } from './fixtures.mjs';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(process.cwd(), '.visual');

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) if (existsSync(join(root, d, sub))) return join(root, d, sub);
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
const page = await ctx.newPage();
const problems = [];
// While a failure is provoked on purpose (a drawing tool that won't load), its console errors are expected.
let provoked = false;
const watch = (p, tag) => {
  p.on('console', (m) => !provoked && (m.type() === 'error' || m.type() === 'warning') ? problems.push(`${tag} ${m.type()}: ${m.text().slice(0, 240)}`) : 0);
  p.on('pageerror', (e) => !provoked && problems.push(`${tag} exception: ${e.message}`));
  p.on('response', (r) => (!provoked && r.status() >= 400 ? problems.push(`${tag} HTTP ${r.status()} ${r.url()}`) : 0));
};
watch(page, 'app');
let n = 0;
const shot = async (name, pg = page) => {
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
};
const svg = (color, label) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${color}"/><circle cx="320" cy="240" r="120" fill="white" opacity=".35"/><text x="320" y="260" font-size="64" text-anchor="middle" fill="white" font-family="sans-serif">${label}</text></svg>`);

await page.goto(URL);
await page.waitForSelector('.sidebar');
await shot('library-empty');

// A page, and a selected box (resize handles)
await page.click('text=Open an example page');
await page.waitForSelector('.block');
await shot('editor');
const box = await page.locator('.block').first().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await shot('editor-selected-box');
const pageId = (await page.evaluate(() => location.hash)).split('/').pop();

// Finite pages: a new page has a sheet, boxes cannot leave it, and the user can make it infinite and back
{
  const inside = async () => {
    const sh = await page.locator('.sheet').boundingBox();
    const bs = await page.$$eval('.world > .block', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    return !!sh && bs.every((b) => b.x >= sh.x - 2 && b.y >= sh.y - 2 && b.x + b.w <= sh.x + sh.width + 2 && b.y + b.h <= sh.y + sh.height + 2);
  };
  if ((await page.locator('.sheet').count()) !== 1) problems.push('sheet: a new page should have a sheet');
  const headH = await page.locator('.ed-head').evaluate((e) => e.getBoundingClientRect().height);
  if (headH > 70) problems.push(`editor header: should fit on one row at 1400px wide, is ${Math.round(headH)}px tall`);
  await shot('finite-page');
  // drag a box far past the right edge and below: it stops at the edge
  const g = page.locator('.world > .block').last();
  await g.hover();
  const grab = g.locator('.grip').first();
  const gb = await grab.boundingBox();
  if (gb) {
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.mouse.down();
    await page.mouse.move(1500, 1400, { steps: 12 });
    await page.mouse.up();
  } else problems.push('sheet: no way found to drag a box');
  if (!(await inside())) problems.push('sheet: a dragged box ended up outside the sheet');
  await shot('finite-page-dragged-to-edge');
  // switch to infinite: no sheet, then back: the sheet holds every box
  await page.click('.ed-size');
  await shot('page-size-menu');
  await page.click('.menu :text("Infinite page")');
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  await shot('infinite-page');
  await page.click('.ed-size');
  await page.click('.menu :text("Landscape page")');
  await page.waitForSelector('.sheet');
  if (!(await inside())) problems.push('sheet: making a page finite should leave every box inside it');
  const lb = await page.locator('.sheet').boundingBox();
  if (!(lb.width > lb.height)) problems.push('sheet: landscape should be wider than tall');
  await shot('finite-landscape');
  await page.click('.ed-size');
  await page.click('.menu :text("Portrait page")');
  await page.waitForFunction(() => { const s = document.querySelector('.sheet'); return s && s.getBoundingClientRect().height > s.getBoundingClientRect().width; });
}
const blocks = await page.$$eval('.block', (els) => els.map((e) => [e.dataset.id, e.className]));
const tag = page.locator('.tag-input').first();
if (await tag.count()) for (const t of ['ideas', 'canvas']) { await tag.fill(t); await tag.press('Enter'); }
// Audio and PDF boxes: add a real WAV and a real two-page PDF from the toolbar
await page.setInputFiles('input[accept^="audio"]', { name: 'team_standup.wav', mimeType: 'audio/wav', buffer: wav() });
await page.waitForSelector('.audio-body audio');
await page.setInputFiles('input[accept^="application/pdf"]', { name: 'Contract.pdf', mimeType: 'application/pdf', buffer: tinyPdf(['First page', 'Second page']) });
await page.waitForSelector('.pdf-body canvas', { timeout: 20000 });
await page.waitForFunction(() => {
  const c = document.querySelector('.pdf-body canvas');
  if (!c || !c.width) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128) return true; // some dark (text) pixel
  return false;
}, null, { timeout: 20000 }).catch(() => problems.push('pdf: the first page was not drawn (canvas stayed blank)'));
if (!(await page.locator('.audio-name', { hasText: 'team standup' }).count())) problems.push('audio: the box should be named from the file ("team standup")');
if (!(await page.locator('.audio-len', { hasText: '0:01' }).count())) problems.push('audio: the clip length (0:01) was not shown');
if (!(await page.locator('.pdf-count', { hasText: '1 / 2' }).count())) problems.push('pdf: expected "1 / 2" under the page');
// Both were placed at the middle of the view, so the tall PDF covers the clip: drag the PDF aside by its name strip
const strip = await page.locator('.pdf-name').boundingBox();
await page.mouse.move(strip.x + 20, strip.y + 10);
await page.mouse.down();
await page.mouse.move(strip.x + 220, strip.y + 10, { steps: 8 });
await page.mouse.up();
const moved = await page.locator('.pdf-name').boundingBox();
if (Math.abs(moved.x - strip.x) < 100) problems.push('pdf: dragging the box by its name strip did not move it');
await shot('audio-pdf-boxes');
await page.click('.pdf-nav.next');
await page.waitForFunction(() => document.querySelector('.pdf-count')?.textContent?.includes('2 / 2'));
if (!(await page.locator('.pdf-nav.next').isDisabled())) problems.push('pdf: Next should be disabled on the last page');
await shot('pdf-page-2');
// Search by block type finds the page; a rejected file says why instead of failing silently
await page.setInputFiles('input[accept^="audio"]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
await page.waitForSelector('text=Only pictures, audio and PDF files');
await shot('media-rejected');
// Draw mode: opens, takes a stroke, closes and reopens without the window going blank; the page stays responsive throughout
const alive = () => Promise.race([page.evaluate(() => document.body.innerText.length), new Promise((r) => setTimeout(() => r(-1), 4000))]);
await page.click('.tools .tool:has-text("Draw")');
await page.waitForSelector('.draw-overlay .excalidraw', { timeout: 15000 }).catch(() => problems.push('draw: the drawing tools should open'));
await page.waitForTimeout(600);
if ((await alive()) < 50) problems.push('draw: the window went blank or froze when Draw was opened');
await shot('draw-open');
// a stroke that runs off the right edge of the sheet (the page is finite): the part on the desk is not shown
await page.locator('[data-testid="toolbar-freedraw"]').evaluate((el) => el.click());
await page.mouse.move(1200, 400); await page.mouse.down(); await page.mouse.move(1385, 500, { steps: 12 }); await page.mouse.up();
await page.waitForTimeout(1000);
await page.click('.draw-done');
await page.waitForFunction(() => !document.querySelector('.draw-overlay'));
if (!(await page.locator('.world > .ink[style*="clip-path"]').count())) problems.push('sheet: ink running past the edge of a finite page should be clipped');
await shot('finite-page-ink-clipped');
if ((await page.locator('.ed-head').count()) !== 1) problems.push('draw: closing draw mode should leave the page');
await page.click('.tools .tool:has-text("Draw")');
await page.waitForSelector('.draw-overlay .excalidraw', { timeout: 15000 }).catch(() => problems.push('draw: reopening should show the drawing again'));
await page.click('.draw-done');
await page.waitForFunction(() => !document.querySelector('.draw-overlay'));
// If the drawing tools cannot load, say so and let the user out: never a blank window
provoked = true;
await page.route('**/blocks/DrawEditor*', (r) => r.abort());
await page.reload();
await page.waitForSelector('.ed-head');
await page.click('.tools .tool:has-text("Draw")');
await page.waitForSelector('.draw-failed', { timeout: 8000 }).catch(() => problems.push('draw: when the drawing tools fail to load there should be a message, not a blank window'));
await shot('draw-failed');
if ((await page.locator('.tools').count()) !== 1) problems.push('draw: the page should still be there behind the failure message');
await page.click('.draw-failed button:has-text("Back to the page")');
await page.waitForFunction(() => !document.querySelector('.draw-overlay'));
await page.unroute('**/blocks/DrawEditor*');
provoked = false;
await page.click('.ed-back');
await page.waitForSelector('.sidebar');
await shot('library-with-page');
// "Search" at the top of the sidebar, with its shortcut: the box and Ctrl+K both open the quick switcher
if (!/Search/.test(await page.locator('.side-search').innerText()) || !/Ctrl\+K/.test(await page.locator('.side-search').innerText())) problems.push('sidebar: the search box should say "Search" and show Ctrl+K');
await page.click('.side-search');
await page.waitForSelector('.palette', { timeout: 5000 }).catch(() => problems.push('sidebar: clicking the search box should open the quick switcher'));
await page.keyboard.press('Escape');
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette', { timeout: 5000 }).catch(() => problems.push('Ctrl+K should open the quick switcher'));
await shot('search-or-ask');
await page.keyboard.press('Escape');

// The Journal: the daily pages as a book (left = the day before, right = the day you write on)
const dayLabel = () => page.locator('.book-heading').innerText().then((t) => t.replace(/\s+/g, ' ').trim());
const todayKey = new Date().toLocaleDateString('en-CA');
if ((await page.locator('.library .main-head button:has-text("Today"), .library .main-head button:has-text("Calendar")').count()) !== 0) problems.push('library: the Today and Calendar buttons should be gone from the page list header');
await page.click('.sidebar .nav-item:has-text("Journal")');
await page.waitForSelector('.book');
const todayHeading = await dayLabel();
if (!/Today/.test(todayHeading)) problems.push(`journal: opening the Journal should show today's page, got "${todayHeading}"`);
await page.waitForSelector('.book-page-body .editor', { timeout: 8000 }).catch(() => problems.push("journal: today's page should be made and shown as soon as the Journal opens"));
if ((await page.locator('.book-page-body .ed-head .ed-title, .book-page-body .ed-head .ed-back').count()) !== 0) problems.push('journal: the page inside the book should have the cut-down header (no title, no back button)');
if ((await page.locator('.sidebar .nav-item:has-text("Journal") .cnt').innerText()) !== '1') problems.push('journal: the sidebar should count one day written');
await shot('journal-today');
if ((await page.locator('.book-page.right').count()) !== 1 || (await page.locator('.book-page.left, .book-spine, .journal-bar button:has-text("One page"), .journal-bar button:has-text("Two pages")').count()) !== 0) problems.push('journal: exactly one page should show, with no two-page option');
if ((await page.locator('.journal-bar button:has-text("Attendance")').count()) !== 1) problems.push('journal: the Attendance button should be at the top of the Journal');
await page.click('.journal-bar button:has-text("Attendance")');
await page.waitForSelector('.toast, [role="status"]', { timeout: 3000 }).catch(() => problems.push('journal: Attendance with no tracked list should explain how to make one'));
// write on the page
await page.dblclick('.book-page-body .ed-body', { position: { x: 500, y: 70 } }); // an empty spot on the sheet, clear of the template's boxes
await page.waitForSelector('.book-page-body .ProseMirror-focused');
await page.keyboard.type('Dear journal, a note for today.');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
// turn forward: a day with no page yet shows an empty page, and nothing is made by looking
await page.click('button[aria-label="Next day"]');
await page.waitForSelector('.book-empty');
if (!/Plan this day/.test(await page.locator('.book-empty').innerText())) problems.push('journal: a future day with no page should offer "Plan this day"');
if ((await page.locator('.sidebar .nav-item:has-text("Journal") .cnt').innerText()) !== '1') problems.push('journal: turning to an empty day must not create a page');
await shot('journal-empty-day');
await page.click('.book-empty button:has-text("Plan this day")');
await page.waitForSelector('.book-page-body .editor');
if ((await page.locator('.sidebar .nav-item:has-text("Journal") .cnt').innerText()) !== '2') problems.push('journal: starting a day should make its page (2 days written)');
// turn back with the previous-day arrow: today's words are still there
await page.click('button[aria-label="Previous day"]');
await page.waitForFunction(() => /Today/.test(document.querySelector('.book-heading')?.textContent ?? ''));
if (!/Dear journal, a note for today\./.test(await page.locator('.book-page-body .ed-body').innerText())) problems.push('journal: what was written on a day should still be there when you turn back to it');
// keys, when not typing
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('[');
await page.waitForSelector('.book-empty');
if (!/Start this day/.test(await page.locator('.book-empty').innerText())) problems.push('journal: a past day with no page should offer "Start this day"');
await page.keyboard.press(']');
await page.waitForFunction(() => /Today/.test(document.querySelector('.book-heading')?.textContent ?? ''));
// the calendar and the Today button
await page.click('.journal-bar .cal-wrap button');
await page.waitForSelector('.cal-pop');
await page.click('.cal-pop .cal-day.has >> nth=-1');
await page.waitForFunction(() => !/Today/.test(document.querySelector('.book-heading')?.textContent ?? ''));
await page.click('.journal-bar button:has-text("Today")');
await page.waitForFunction(() => /Today/.test(document.querySelector('.book-heading')?.textContent ?? ''));
// contents
await page.click('.journal-bar button:has-text("Contents")');
await page.waitForSelector('.book-contents');
const covered = await page.evaluate(() => { const c = document.querySelector('.book-contents'); const r = c.getBoundingClientRect(); let bad = 0; for (let y = r.top + 10; y < r.bottom - 10; y += 25) for (let x = r.left + 10; x < r.right - 10; x += 25) { const el = document.elementFromPoint(x, y); if (!el || (!c.contains(el) && !el.closest('.toasts'))) bad++; } return bad; });
if (covered) problems.push('journal: the contents panel should sit above the page, but ' + covered + ' points of it are covered');
const rows = await page.locator('.book-toc-row').count();
if (rows !== 2) problems.push(`journal: the contents should list the 2 days written, found ${rows}`);
if (!/Dear journal/.test(await page.locator('.book-toc-row').nth(1).innerText()) || !/nothing written yet/.test(await page.locator('.book-toc-row').nth(0).innerText())) problems.push('journal: the contents should show what was written (not the template\'s lines), and say so when a day has nothing written yet');
await page.fill('input[aria-label="Search the journal"]', 'dear journal');
if ((await page.locator('.book-toc-row').count()) !== 1) problems.push('journal: searching the contents should narrow it to the day with those words');
await page.fill('input[aria-label="Search the journal"]', 'zzznothing');
if (!(await page.locator('.book-toc-empty').count())) problems.push('journal: a search with no match should say so');
await page.fill('input[aria-label="Search the journal"]', '');
await shot('journal-contents');
await page.click('.book-toc-row >> nth=0');
await page.waitForFunction(() => !document.querySelector('.book-contents'));
// deleting a day's page: it goes to Trash and is not made again by looking at it (today is the case that could come straight back)
if ((await page.locator('.journal-bar button:has-text("Today")').count()) > 0) await page.click('.journal-bar button:has-text("Today")');
await page.waitForFunction(() => /Today/.test(document.querySelector('.book-heading')?.textContent ?? ''));
await page.click('.book-delete');
await page.waitForSelector('.dialog');
await page.click('.dialog button.danger:has-text("Delete page")');
await page.waitForSelector('.book-empty', { timeout: 5000 }).catch(() => problems.push("journal: deleting today's page should leave an empty page"));
await page.waitForTimeout(900);
if ((await page.locator('.book-page-body .editor').count()) !== 0) problems.push("journal: today's page must not be made again straight after it was deleted");
if ((await page.locator('.sidebar .nav-item:has-text("Journal") .cnt').innerText()) !== '1') problems.push('journal: the count should drop to 1 after deleting a day');
if ((await page.locator('.sidebar .nav-item:has-text("Trash") .cnt').innerText()) === '0') problems.push('journal: the deleted page should be in Trash');
await shot('journal-deleted-day');
await page.click('.book-empty button:has-text("Start this day")');
await page.waitForSelector('.book-page-body .editor');
// All pages no longer holds the daily pages
await page.click('.sidebar .nav-item:has-text("All pages")');
await page.waitForSelector('.cards');
if ((await page.locator('.cards .card:has-text("Nov"), .cards .card:has-text("Oct"), .cards .card:has-text("Dec")').count()) !== 0 && (await page.locator('.sidebar .nav-item:has-text("All pages") .cnt').innerText()) !== '1') problems.push('library: All pages should not list the daily pages');
// the address of a day's page opens the book, not a plain page editor
const dayId = await page.evaluate(async () => {
  const m = await import('/src/store/notes/index.ts');
  return Object.values(m.useNotes.getState().pages).find((p) => p.dailyDate && (p.blocks.length || true))?.id;
});
await page.evaluate((id) => { location.hash = `#/page/${id}`; }, dayId);
await page.waitForSelector('.book', { timeout: 8000 }).catch(() => problems.push("journal: a daily page's address should open the Journal"));
if ((await page.locator('.ed-back').count()) !== 0) problems.push("a daily page was opened as a plain page editor (it should open in the Journal)");
// Ctrl+Alt+D from another screen
await page.click('.sidebar .nav-item:has-text("Cards")');
await page.waitForSelector('.cgrid, .empty');
await page.keyboard.press('Control+Alt+d');
await page.waitForSelector('.book', { timeout: 5000 }).catch(() => problems.push('Ctrl+Alt+D should open the Journal at today'));
// and the quick switcher finds a day
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette');
await page.keyboard.type('Nov');
if (!(await page.locator('.palette >> text=Journal').count())) problems.push('the quick switcher should list days of the journal, marked "Journal"');
await page.keyboard.press('Escape');
await page.click('.sidebar .nav-item:has-text("All pages")');


// Groups
await page.click('.sidebar >> text=Groups');
for (const name of ['Work', 'Personal']) {
  await page.click('button:has-text("New group")');
  await page.fill('.dialog input', name);
  await page.click('.dialog button.primary');
}
await page.click('article.bcard:has-text("Work") .bmenu');
await page.click('text=New subgroup…');
await page.fill('.dialog input', 'ML projects');
await page.click('.dialog button.primary');
await shot('groups');
await page.click('article.bcard:has-text("Work")');
await shot('group-open');
await page.click('.sidebar >> text=Groups');
await page.fill('input[aria-label="Search groups"]', 'work ml');
await shot('groups-search');

// Tags
await page.click('.sidebar >> text=Tags');
await shot('tags');

// Page search operators: #tag narrows, an unknown tag empties the list with the helpful empty state
await page.click('.sidebar >> text=All pages');
await page.fill('input[aria-label="Search pages"]', '#guide');
await shot('search-tag');
await page.fill('input[aria-label="Search pages"]', '#nosuchtag has:image after:2020-01-01');
await shot('search-empty');
if (!(await page.locator('text=No pages match your search').count())) problems.push('search: an impossible query should show "No pages match your search"');
await page.fill('input[aria-label="Search pages"]', '');

// Cards, typing into the details (a regression check: focus must stay in the editor)
await page.click('.sidebar >> text=Cards');
for (const [color, label, text] of [['#e11d48', 'Tokyo', 'Flights booked for March.'], ['#0d9488', 'Garden', 'Tomatoes and basil.'], [null, 'No picture', 'A plain card']]) {
  await page.click('button:has-text("New card")');
  await page.waitForSelector('.card-detail');
  await page.fill('.cd-label', label);
  if (color) await page.setInputFiles('.card-detail input[type=file]', { name: 'c.svg', mimeType: 'image/svg+xml', buffer: svg(color, label) });
  await page.click('.cd-body .ProseMirror');
  await page.keyboard.type(text);
  if (label === 'Tokyo') await shot('card-detail');
  await page.click('.card-detail button:has-text("Done")');
}
const tiles = await page.locator('.ctile').count();
if (tiles !== 3) problems.push(`cards: expected 3 tiles, found ${tiles} (typing may be creating extra cards)`);
await shot('cards');
await page.fill('input[aria-label="Search cards"]', 'basil');
await shot('cards-search');
await page.fill('input[aria-label="Search cards"]', '');

// Card tags and sets: tag two cards, filter by a tag chip, put a card in a set and show only that set
for (const [label, tag] of [['Tokyo', 'travel'], ['Garden', 'plants']]) {
  await page.click(`.ctile:has-text("${label}")`);
  await page.waitForSelector('.card-detail');
  await page.fill('input[aria-label="Add a tag to this card"]', tag);
  await page.keyboard.press('Enter');
  if (label === 'Tokyo') {
    const opts = await page.locator('select[aria-label="Set (group) this card belongs to"] option').count();
    if (opts < 2) problems.push('card sets: the set picker lists no groups');
    else await page.selectOption('select[aria-label="Set (group) this card belongs to"]', { index: 1 });
    await shot('card-detail-tags');
  }
  await page.click('.card-detail button:has-text("Done")');
}
await page.click('.tagbar button:has-text("#plants")');
if ((await page.locator('.ctile').count()) !== 1) problems.push('card tags: the #plants chip should leave exactly one card');
await shot('cards-tag-filter');
await page.click('.tagbar button:has-text("#plants")');
await page.selectOption('select[aria-label="Show set of cards"]', '-');
if ((await page.locator('.ctile').count()) !== 2) problems.push('card sets: "No set" should show the two cards not put in a set');
await shot('cards-set-filter');
await page.selectOption('select[aria-label="Show set of cards"]', '');

// Board: columns per set, drag a card to another column
await page.click('button.seg-btn:has-text("Board")');
await shot('cards-board');
const colCount = async (title) => Number(await page.locator(`.kb-col:has(h2[title="${title}"]) .kb-head .cnt`).textContent());
const workBefore = await colCount('Work');
await page.locator('.kb-card:has-text("Garden")').dragTo(page.locator('.kb-col:has(h2[title="Work"]) .kb-body'));
const workAfter = await colCount('Work');
if (workAfter !== workBefore + 1) problems.push(`card board: dragging Garden onto Work should add one card there (had ${workBefore}, now ${workAfter})`);
await shot('cards-board-dragged');
await page.click('button.seg-btn:has-text("Gallery")');

// Cards on a page: make one from the toolbar, tap it open, drag it, add an existing card, delete a box (the card must survive)
await page.click('.sidebar >> text=All pages');
await page.click('.library .main >> text=Canvas basics');
await page.waitForSelector('.block');
await page.click('.tools button:has-text("Card")');
await page.click('[role=menu] button:has-text("New card")');
await page.waitForSelector('.card-detail');
if ((await page.locator('.card-detail button:has-text("Open on canvas")').count()) !== 0) problems.push('card box: "Open on canvas" should be gone, a card is not a page');
await page.fill('.cd-label', 'On-page card');
await page.click('.card-detail button:has-text("Done")');
await page.waitForSelector('.block.b-card .ctile-label:has-text("On-page card")');
await shot('card-on-page');
const cardBox = () => page.locator('.block.b-card').first().boundingBox();
const b0 = await cardBox();
await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
await page.mouse.down();
await page.mouse.move(b0.x + b0.width / 2 - 140, b0.y + b0.height / 2 + 60, { steps: 8 });
await page.mouse.up();
const b1 = await cardBox();
if (Math.abs(b1.x - b0.x) < 80) problems.push('card box: dragging the tile should move the box');
if ((await page.locator('.card-detail').count()) !== 0) problems.push('card box: dragging the tile must not open the card');
await page.mouse.click(b1.x + b1.width / 2, b1.y + b1.height / 2);
await page.waitForSelector('.card-detail', { timeout: 5000 }).catch(() => problems.push('card box: tapping the tile should open the card'));
await page.keyboard.press('Escape');
await page.locator('.block.b-card').first().hover();
if (!(await page.locator('.block.b-card button[aria-label="Open card"]').count())) problems.push('card box: the hover bar should have an Open button');
await page.click('.tools button:has-text("Card")');
if (!(await page.locator('[role=menu] button:has-text("Garden")').count())) problems.push('card box: the menu should list existing cards');
await page.click('[role=menu] button:has-text("Garden")');
await page.waitForSelector('.block.b-card:has-text("Garden")');
{
  const n = await page.locator('.block.b-card').count();
  if (n !== 2) problems.push(`card box: expected 2 card boxes, found ${n}`);
}
await shot('cards-two-on-page');
await page.locator('.block.b-card:has-text("Garden")').click({ position: { x: 20, y: 20 } }).catch(() => {});
await page.keyboard.press('Escape');
await page.keyboard.press('Delete');
await page.waitForFunction(() => document.querySelectorAll('.block.b-card').length <= 1);
// A card is not a page: its address goes to the Cards gallery, and the card is still there after its box is gone
const cardId = await page.evaluate(async () => {
  const m = await import('/src/store/notes/index.ts');
  return Object.values(m.useNotes.getState().pages).find((p) => p.kind === 'card' && p.title === 'On-page card')?.id;
});
if (!cardId) problems.push('card box: the card made from the page should exist as its own item');
await page.evaluate((id) => { location.hash = `#/page/${id}`; }, cardId);
await page.waitForSelector('.cgrid', { timeout: 8000 }).catch(() => problems.push('a card address should open the Cards gallery, not an editor'));
if ((await page.locator('.editor').count()) !== 0) problems.push('a card was opened as a page editor');
if (!(await page.locator('.ctile-label:has-text("On-page card")').count())) problems.push('the card should still be in the Cards gallery');
await shot('card-address-redirect');

// Settings: every tab must be reachable
await page.click('.side-settings');
await shot('settings');
for (const t of ['Appearance', 'Editor', 'Sync', 'Desktop', 'Add-ons', 'Data', 'About']) {
  const tab = page.locator(`[role=tab]:has-text("${t}")`);
  if (!(await tab.isVisible())) problems.push(`settings: tab ${t} is not visible`);
  else await tab.click();
}
await shot('settings-last-tab');
// Encrypted backup: the passphrase prompt is masked, and a mismatch saves nothing
await page.click('[role=tab]:has-text("Data")');
await page.click('button:has-text("Encrypted backup")');
const pw = page.locator('input[type=password]');
if ((await pw.count()) !== 1) problems.push('encrypted backup: the passphrase field must be a masked (password) field');
await pw.fill('first');
await shot('backup-passphrase');
await page.keyboard.press('Enter');
await page.locator('input[type=password]').fill('second');
await page.keyboard.press('Enter');
if (!(await page.locator('text=passphrases didn').count())) problems.push('encrypted backup: mismatched passphrases should say so');
await page.keyboard.press('Escape');

// Desktop widgets (layout only: the desktop shell isn't there in a browser)
const w = await ctx.newPage();
watch(w, 'widget');
for (const [name, cls, size] of [['text', 'b-text', [420, 260]], ['list', 'b-checklist', [360, 300]], ['table', 'b-table', [460, 340]]]) {
  const id = blocks.find((b) => b[1].includes(cls))?.[0];
  await w.setViewportSize({ width: size[0], height: size[1] });
  await w.goto(`${URL}/?widget=${pageId}&block=${id}`, { waitUntil: 'domcontentloaded' });
  await w.waitForSelector('.widget-body .block');
  await shot(`widget-${name}`, w);
}
await w.setViewportSize({ width: 560, height: 440 });
await w.goto(`${URL}/?widget=${pageId}`, { waitUntil: 'domcontentloaded' }); // the dev server is slow to serve the PDF worker the first time; the selector waits below are what matter
await w.waitForSelector('.widget-body .viewport');
await shot('widget-page', w);
await w.goto(`${URL}/?widget=${pageId}&block=missing`, { waitUntil: 'domcontentloaded' });
await w.waitForSelector('.widget-gone');
await shot('widget-deleted', w);

await browser.close();
console.log(`${n} screenshots in ${OUT}`);
if (problems.length) {
  console.error('\nPROBLEMS:\n' + [...new Set(problems)].join('\n'));
  process.exit(1);
}
console.log('No console errors, failed requests or uncaught exceptions.');
