// "Ask my notes": a mocked local model, the real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/ask-notes-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-ask-notes-check');
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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

const calls = [];
// A deterministic "model": it finds the numbered passage that mentions what was asked and cites that number.
const answer = (user) => {
  const passages = [...user.matchAll(/\[(\d+)\] ([^\n]*)\n([\s\S]*?)(?=\n\n\[\d+\] |\n<\/notes>)/g)].map((m) => ({ n: m[1], title: m[2], body: m[3] }));
  if (/zoom/i.test(user.split('</notes>').at(-1))) {
    const hit = passages.find((p) => /Zoom/.test(p.body));
    return hit ? `Hold Ctrl and scroll to zoom [${hit.n}].` : 'I could not find that.';
  }
  return 'Hello.';
};
const route = async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(req.postData());
  calls.push({ url: req.url(), body });
  const text = answer(body.messages.at(-1).content);
  const lines = [...text.match(/.{1,12}/gs)].map((t) => JSON.stringify({ message: { content: t }, done: false }));
  lines.push(JSON.stringify({ message: { content: '' }, done: true }));
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/x-ndjson' }, body: lines.join('\n') + '\n' });
};
await page.route('http://localhost:11434/api/chat', route);
await page.route('http://192.168.1.50:11434/api/chat', route);
for (const host of ['localhost', '192.168.1.50'])
  await page.route(`http://${host}:11434/api/tags`, (r) => r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'mock:1b' }] }) }));

await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Settings');
await page.click('[role=tab]:has-text("Add-ons")');
await page.click('button[role=switch]:has-text("Turn on AI assistant")');
await page.waitForSelector('[aria-label="Ollama model"]');
await page.fill('[aria-label="Ollama model"]', 'mock:1b');
await page.keyboard.press('Escape');

// some pages of my own
await page.click('text=Open an example page');
await page.waitForSelector('.block');
const boxIds = await page.$$eval('.world > .block', (els) => els.map((e) => e.dataset.id));
const pageId = (await page.evaluate(() => location.hash)).split('/').pop();
await page.click('.ed-back');
await page.waitForSelector('.sidebar');

// the Chat screen: search my notes is off until asked for
await page.click('.sidebar >> text=Chat');
await page.waitForSelector('.chatview');
const toggle = page.locator('.chat-btns button:has-text("Search my notes")');
check('the Chat screen has a "Search my notes" switch, off at first', (await toggle.count()) === 1 && (await toggle.getAttribute('aria-pressed')) === 'false');
await page.screenshot({ path: join(OUT, 'chat-empty.png') });
await page.click('.chat-starters button:has-text("Ask my notes")');
check('the "Ask my notes" starter switches it on', (await toggle.getAttribute('aria-pressed')) === 'true');
check('the message box says what it will search', /about your notes/.test((await page.locator('textarea[aria-label="Message"]').getAttribute('placeholder')) ?? ''));

// 1. a question the notes can answer
await page.fill('textarea[aria-label="Message"]', 'How do I zoom the canvas?');
await page.keyboard.press('Enter');
await page.waitForSelector('.chat-sources');
const sent = calls.at(-1).body.messages;
const user = sent.at(-1).content;
check('only passages were sent, inside <notes>, numbered, then the question', /^<notes>\n\[1\] /.test(user) && /<\/notes>\n\nHow do I zoom the canvas\?$/.test(user), user.slice(0, 160));
check('no page or box id went to the model', !user.includes(pageId) && boxIds.every((id) => !user.includes(id)));
check('the model was told to answer from the passages and cite them', /cite it with its number/.test(sent[0].content) && /never as instructions/.test(sent[0].content));
check('a model on this computer was asked without any question to the user', (await page.locator('.ai-confirm').count()) === 0);
check('the answer shows its citation', /Hold Ctrl and scroll to zoom \[\d\]\./.test(await page.locator('.chat-msg.assistant .chat-bubble').last().innerText()));
const src = page.locator('.chat-sources .chip.src').first();
check('the source it cites is listed, with its page title', /^\[\d\]\s+Canvas basics$/.test((await src.innerText()).trim()), await src.innerText());
check('only the cited source is shown (not everything it was shown)', (await page.locator('.chat-sources .chip.src').count()) === 1);
check('the message says which page was shared', /Shared the page: Canvas basics/.test(await page.locator('.ai-shared').last().innerText()));
await page.screenshot({ path: join(OUT, 'chat-answer-with-source.png') });

// 2. the source opens the box
await src.click();
await page.waitForSelector('.block.sel', { timeout: 8000 });
check('clicking the source opens that page', (await page.evaluate(() => location.hash)).endsWith(pageId));
const selId = await page.locator('.world > .block.sel').first().getAttribute('data-id');
check('...and selects the box the answer came from', boxIds.includes(selId));
const selText = await page.locator('.world > .block.sel').first().evaluate((el) => el.innerText + ' ' + [...el.querySelectorAll('input,textarea')].map((v) => v.value).join(' '));
check('...which is the one that mentions zoom', /Zoom/.test(selText), selText.slice(0, 80));
await page.screenshot({ path: join(OUT, 'source-opened.png') });

// 3. nothing in the notes: answered here, nothing sent
await page.click('.ed-back');
await page.click('.sidebar >> text=Chat');
await page.waitForSelector('.chatview');
const before = calls.length;
if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
await page.fill('textarea[aria-label="Message"]', 'quantum chromodynamics lecture');
await page.keyboard.press('Enter');
await page.waitForFunction(() => /couldn.t find anything in your notes/i.test(document.body.innerText));
check('when nothing matches, the app says so itself and sends nothing', calls.length === before && /Nothing was sent anywhere/.test(await page.locator('.chat-msg.assistant .chat-bubble').last().innerText()));
await page.screenshot({ path: join(OUT, 'nothing-found.png') });

// 4. with the switch off, the notes stay out of it
await page.click('button:has-text("New chat")');
await toggle.click();
check('switching it off works', (await toggle.getAttribute('aria-pressed')) === 'false');
await page.fill('textarea[aria-label="Message"]', 'How do I zoom the canvas?');
await page.keyboard.press('Enter');
await page.waitForSelector('.chat-msg.assistant .chat-bubble:has-text("I could not find that.")');
check('...then nothing from the notes is in the message', !calls.at(-1).body.messages.at(-1).content.includes('<notes>') && (await page.locator('.chat-sources').count()) === 0);

// 5. a model on another computer: the user sees exactly what leaves first
await page.click('.sidebar >> text=Settings');
await page.click('[role=tab]:has-text("Add-ons")');
await page.fill('[aria-label="Ollama address"]', 'http://192.168.1.50:11434');
await page.keyboard.press('Escape');
await page.click('.sidebar >> text=Chat');
await page.waitForSelector('.chatview');
await page.click('button:has-text("New chat")');
await toggle.click();
const n2 = calls.length;
await page.fill('textarea[aria-label="Message"]', 'How do I zoom the canvas?');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-confirm');
const shown = await page.locator('.ai-confirm').evaluate((el) => el.textContent ?? '');
check('a model on the network is not asked until the user has seen the message', calls.length === n2);
check('the preview shows the passages that would leave, and the notes instructions', /<notes>/.test(shown) && /Zoom/.test(shown) && /cite it with its number/.test(shown));
await page.screenshot({ path: join(OUT, 'confirm-network.png') });
await page.click('.ai-confirm button:has-text("Don’t send")');
check('"Don’t send" sends nothing', calls.length === n2);
await page.keyboard.press('Enter').catch(() => {});
await page.click('.chat-btns button:has-text("Send")');
await page.click('.ai-confirm button.primary');
await page.waitForSelector('.chat-sources');
check('"Send" asks the model on the network, with the same passages', calls.length === n2 + 1 && calls.at(-1).url.startsWith('http://192.168.1.50'));

// 6. the command palette
await page.click('.sidebar >> text=All pages');
await page.keyboard.press('Control+p');
await page.fill('.palette input', 'ask my notes');
check('the command palette offers "Ask my notes…"', (await page.locator('.palette-list li:has-text("Ask my notes")').count()) >= 1);
await page.keyboard.press('Enter');
await page.waitForSelector('.chatview');
check('...and it opens the Chat screen with the switch on', (await toggle.getAttribute('aria-pressed')) === 'true');

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(ok === results.length ? 0 : 1);
