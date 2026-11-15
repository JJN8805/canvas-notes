// "Review the week": the real app in headless Chromium, with a mocked local model for the AI hand-off.
// Run with the dev server up (`npm run dev`):  node scripts/weekly-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-weekly-check');
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
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));
const calls = [];
await page.route('http://localhost:11434/api/chat', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  calls.push(JSON.parse(req.postData()));
  const lines = ['A calm, steady week.'].map((t) => JSON.stringify({ message: { content: t }, done: false }));
  lines.push(JSON.stringify({ message: { content: '' }, done: true }));
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/x-ndjson' }, body: lines.join('\n') + '\n' });
});
await page.route('http://localhost:11434/api/tags', (r) => r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'mock:1b' }] }) }));

await page.goto(URL);
await page.waitForSelector('.sidebar');
// today's journal page, with something written on it
await page.click('.sidebar >> text=Journal');
await page.waitForSelector('.book-page-body .editor');
await page.dblclick('.book-page-body .ed-body', { position: { x: 500, y: 70 } });
await page.waitForSelector('.book-page-body .ProseMirror-focused');
await page.keyboard.type('Shipped the weekly review feature');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

const pagesCount = async () => Number(((await page.locator('.sidebar .nav-item:has-text("All pages") .cnt').innerText()) || '0').trim());
const before = await pagesCount();

// 1. the Week button shows the review
await page.click('.journal-bar button:has-text("Week")');
await page.waitForSelector('.dialog.weekly');
const dlg = await page.locator('.dialog.weekly').innerText();
check('the review has a title for the week', /Week of (Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} \w{3} \d{4}/.test(dlg), dlg.slice(0, 80));
check('it lists seven days', (await page.locator('.dialog.weekly section[aria-label="The days"] li').count()) === 7);
check('what was written today is in it', /Shipped the weekly review feature/.test(dlg));
check('days with no page say so', /no page/.test(dlg));
check('it says nothing is saved until Create page', /Nothing is saved until you press Create page/.test(dlg));
await page.screenshot({ path: join(OUT, '1-review.png') });

// 2. Cancel makes nothing
await page.click('.dialog.weekly button:has-text("Cancel")');
await page.waitForFunction(() => !document.querySelector('.dialog.weekly'));
check('Cancel makes no page', (await pagesCount()) === before);

// Escape too
await page.keyboard.press('Control+p');
await page.fill('.palette input', 'review my week');
check('the command palette has "Review my week…"', (await page.locator('.palette-list li:has-text("Review my week")').count()) === 1);
await page.keyboard.press('Enter');
await page.waitForSelector('.dialog.weekly');
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.dialog.weekly'));
check('Escape closes it and makes no page', (await pagesCount()) === before);

// 3. Create page
await page.click('.journal-bar button:has-text("Week")');
await page.waitForSelector('.dialog.weekly');
check('without an AI add-on there is no "ask AI" button', (await page.locator('.dialog.weekly button:has-text("ask AI")').count()) === 0);
await page.click('.dialog.weekly button:has-text("Create page")');
await page.waitForFunction(() => !document.querySelector('.dialog.weekly'));
await page.waitForSelector('.toast:has-text("Created")');
check('Create page makes one page', (await pagesCount()) === before + 1);
await page.click('.toast button:has-text("Open")');
await page.waitForSelector('.world > .block');
const title = await page.locator('.ed-title').inputValue();
check('the page is titled for the week', /^Week of /.test(title), title);
const texts = (await page.locator('.world > .block').allInnerTexts()).join('\n');
check('it holds the days, with what was written', /The days/.test(texts) && /Shipped the weekly review feature/.test(texts));
check('it is a finite page and every box is on the sheet', await page.evaluate(() => { const s = document.querySelector('.sheet')?.getBoundingClientRect(); return !!s && [...document.querySelectorAll('.world > .block')].every((e) => { const r = e.getBoundingClientRect(); return r.x >= s.x - 2 && r.right <= s.right + 2 && r.y >= s.y - 2 && r.bottom <= s.bottom + 2; }); }));
await page.screenshot({ path: join(OUT, '2-the-page.png') });

// 4. it says a page for the week already exists
await page.click('.ed-back');
await page.click('.sidebar >> text=Journal');
await page.click('.journal-bar button:has-text("Week")');
await page.waitForSelector('.dialog.weekly');
check('a second review says the page already exists and offers to open it', /already exists/.test(await page.locator('.dialog.weekly').innerText()) && (await page.locator('.dialog.weekly button:has-text("Create another page")').count()) === 1);
await page.screenshot({ path: join(OUT, '3-already-exists.png') });
await page.keyboard.press('Escape');

// 5. with the AI assistant on: create the page and ask for a reflection
await page.click('.sidebar >> text=Settings');
await page.click('[role=tab]:has-text("Add-ons")');
await page.click('button[role=switch]:has-text("Turn on AI assistant")');
await page.waitForSelector('[aria-label="Ollama model"]');
await page.fill('[aria-label="Ollama model"]', 'mock:1b');
await page.keyboard.press('Escape');
await page.click('.sidebar >> text=Journal');
await page.click('.journal-bar button:has-text("Week")');
await page.waitForSelector('.dialog.weekly');
const askBtn = page.locator('.dialog.weekly button:has-text("ask AI to reflect")');
check('with the AI assistant on, "Create page and ask AI to reflect" is offered', (await askBtn.count()) === 1);
const n0 = await pagesCount();
await askBtn.click();
await page.waitForSelector('.chatview');
await page.waitForSelector('.chat-msg.assistant .chat-bubble:has-text("calm, steady week")', { timeout: 10000 });
check('it made the page and opened Chat, which answered', (await pagesCount()) === n0 + 1);
const sent = calls.at(-1).messages.at(-1).content;
check('the question carried the week’s page inside <page> tags', /^<page>\n/.test(sent) && /Week of /.test(sent) && /Shipped the weekly review feature/.test(sent) && /reflection on my week/.test(sent), sent.slice(0, 120));
check('a model on this computer was asked without a prompt', (await page.locator('.ai-confirm').count()) === 0);
await page.screenshot({ path: join(OUT, '4-reflection.png') });

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
