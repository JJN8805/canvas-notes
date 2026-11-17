// Searching notes by meaning: a mocked local model and embedder, the real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/rag-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-rag-check');
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
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/esm\.sh|font|Failed to load resource/i.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

/* ---- a toy embedder: words of one idea share a dimension, so meaning matches where words do not ---- */
const CONCEPTS = [['cost', 'costs', 'spending', 'budget', 'expensive', 'cut', 'savings'], ['meeting', 'call', 'standup', 'agenda'], ['garden', 'plants', 'soil', 'seeds', 'tomato']];
const vec = (text) => {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return CONCEPTS.map((c) => words.filter((w) => c.includes(w)).length);
};
const embedCalls = [];
const chatCalls = [];
let cloudCalls = 0;
await page.route('http://localhost:11434/api/embed', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(req.postData());
  embedCalls.push(body.input);
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ embeddings: body.input.map(vec) }) });
});
await page.route('http://localhost:11434/api/tags', (r) => r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'mock:1b' }, { name: 'nomic-embed-text:latest' }] }) }));
await page.route('http://localhost:11434/api/chat', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(req.postData());
  chatCalls.push(body);
  const user = body.messages.at(-1).content;
  const hit = [...user.matchAll(/\[(\d+)\] [^\n]*\n([^\n]*)/g)].find((m) => /cut costs/.test(m[2]));
  const text = hit ? `You agreed to cut costs [${hit[1]}].` : 'I could not find that.';
  const lines = [...text.match(/.{1,12}/gs)].map((t) => JSON.stringify({ message: { content: t }, done: false }));
  lines.push(JSON.stringify({ message: { content: '' }, done: true }));
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/x-ndjson' }, body: lines.join('\n') + '\n' });
});
await page.route('https://api.openai.com/**', (r) => {
  cloudCalls++;
  return r.fulfill({ status: 500, headers: cors, body: '{}' });
});

await page.goto(URL);
await page.waitForSelector('.sidebar');

/* ---- two pages: one about costs (no word "spending"), one about a garden ---- */
async function makePage(title, text) {
  await page.goto(URL + '#/');
  await page.waitForSelector('.sidebar');
  await page.click('.sidebar >> text=All pages');
  await page.click('button:has-text("New page")');
  await page.click('.tpl:has-text("Blank")');
  await page.waitForSelector('.ed-body');
  await page.locator('input[aria-label="Page title"], .ed-title').first().fill(title);
  await page.click('.tools .tool:has-text("Note")');
  await page.waitForTimeout(300);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
}
await makePage('Planning', 'We agreed to cut costs next quarter.');
await makePage('Garden', 'Plant tomato seeds in rich soil.');

/* ---- switch the assistant on: search by meaning is on, with the cloud off ---- */
await page.goto(URL + '#/');
await page.waitForSelector('.sidebar');
await page.click('.side-settings');
await page.click('[role=tab]:has-text("Add-ons")');
await page.click('button[role=switch]:has-text("Turn on AI assistant")');
await page.waitForSelector('[aria-label="Ollama model"]');
await page.fill('[aria-label="Ollama model"]', 'mock:1b');
await page.waitForSelector('.rag-settings');
check('Settings has a "Search my notes by meaning" section, on, made by this computer', (await page.locator('.rag-settings input[type=checkbox]').first().isChecked()) && (await page.inputValue('select[aria-label="Where embeddings are made"]')) === 'local');
check('the cloud sources say they send your notes', (await page.locator('select[aria-label="Where embeddings are made"] option:has-text("sends your notes")').count()) === 2);
await page.waitForFunction(() => /Up to date: \d+ passages/.test(document.querySelector('.rag-status')?.textContent ?? ''), null, { timeout: 30000 });
const status = await page.locator('.rag-status').innerText();
check('the notes are indexed in the background', /Up to date: [2-9]\d* passages|Up to date: \d+ passages/.test(status), status);
check('each passage was embedded as a document, by Ollama on this computer', embedCalls.flat().some((t) => t.startsWith('search_document: Planning\nWe agreed')) && cloudCalls === 0);
await page.locator('.rag-settings').scrollIntoViewIfNeeded();
await page.locator('.rag-settings h4').scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelector('.rag-settings').scrollIntoView({ block: 'start' }));
await page.screenshot({ path: join(OUT, 'settings.png'), fullPage: false });

/* ---- the cloud stays off until agreed ---- */
await page.selectOption('select[aria-label="Where embeddings are made"]', 'openai');
await page.waitForSelector('.dialog:has-text("Send your notes to OpenAI?")');
check('choosing a cloud source asks first, and says what is sent', (await page.locator('.dialog:has-text("Send your notes to OpenAI?")').innerText()).includes('every page in your library') && (await page.locator('.dialog:has-text("Send your notes to OpenAI?")').innerText()).includes('every question you search for'));
await page.screenshot({ path: join(OUT, 'cloud-consent.png') });
await page.click('.dialog:has-text("Send your notes to OpenAI?") button:has-text("Cancel")');
await page.waitForFunction(() => ![...document.querySelectorAll('.dialog')].some((d) => d.textContent.includes('Send your notes to OpenAI?')));
check('cancelling keeps it on this computer, and nothing was sent', (await page.inputValue('select[aria-label="Where embeddings are made"]')) === 'local' && cloudCalls === 0);
await page.selectOption('select[aria-label="Where embeddings are made"]', 'openai');
await page.waitForSelector('.dialog:has-text("Send your notes to OpenAI?")');
await page.click('.dialog:has-text("Send your notes to OpenAI?") button:has-text("Send my notes to OpenAI")');
await page.waitForFunction(() => document.querySelector('select[aria-label="Where embeddings are made"]')?.value === 'openai');
await page.waitForFunction(() => /Stopped:/.test(document.querySelector('.rag-status')?.textContent ?? ''), null, { timeout: 20000 });
check('after agreeing, it still sends nothing without an API key, and says so', cloudCalls === 0 && /API key/.test(await page.locator('.rag-status').innerText()));
await page.selectOption('select[aria-label="Where embeddings are made"]', 'local');
await page.waitForFunction(() => /Up to date/.test(document.querySelector('.rag-status')?.textContent ?? ''), null, { timeout: 30000 });
check('switching back to this computer works again at once', true);
await page.keyboard.press('Escape');

/* ---- the Chat screen: found by meaning ---- */
const before = chatCalls.length;
await page.click('.sidebar >> text=Chat');
await page.waitForSelector('.chatview');
await page.click('.chat-btns button:has-text("Search my notes")');
check('the line under the switch says it searches by words and meaning', /words and meaning/.test(await page.locator('.chat-searchinfo').innerText()), await page.locator('.chat-searchinfo').innerText());
const embedsBefore = embedCalls.length;
await page.fill('textarea[aria-label="Message"]', 'what did we decide about spending?');
await page.keyboard.press('Enter');
await page.waitForSelector('.chat-sources');
check('the question was embedded as a query', embedCalls.slice(embedsBefore).flat().some((t) => t === 'search_query: what did we decide about spending?'));
const wire = chatCalls.at(-1).messages.at(-1).content;
check('the note was found by meaning although it shares no word with the question', chatCalls.length === before + 1 && /\[1\] Planning\nWe agreed to cut costs/.test(wire), wire.slice(0, 200));
check('the answer cites it and the source is shown', /\[1\]/.test(await page.locator('.chat-msg.assistant').last().innerText()) && (await page.locator('.chat-sources .src:has-text("Planning")').count()) === 1);
check('the garden page was not sent', !/tomato/.test(wire));
await page.screenshot({ path: join(OUT, 'chat-answer.png') });

/* ---- with search by meaning off, the same question finds nothing (words only) ---- */
await page.click('.side-settings');
await page.click('[role=tab]:has-text("Add-ons")');
await page.waitForSelector('.rag-settings');
await page.uncheck('.rag-settings input[type=checkbox] >> nth=0');
await page.keyboard.press('Escape');
const chatBefore = chatCalls.length;
await page.fill('textarea[aria-label="Message"]', 'what did we decide about spending?');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.body.innerText.includes('I couldn’t find anything in your notes'));
check('words alone miss it, and nothing is sent to any model', chatCalls.length === chatBefore);
await page.click('.side-settings');
await page.click('[role=tab]:has-text("Add-ons")');
await page.check('.rag-settings input[type=checkbox] >> nth=0');
await page.keyboard.press('Escape');

/* ---- the assistant drawer: also search my other notes ---- */
await page.goto(URL + '#/');
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=All pages');
await page.click('.card-title:text-is("Garden")');
await page.waitForSelector('.ed-body');
await page.click('button:has-text("Assistant")');
await page.waitForSelector('.ai-panel');
const alsoBefore = chatCalls.length;
await page.check('.ai-panel label:has-text("Also search my other notes") input');
await page.uncheck('.ai-panel label:has-text("Share this page") input').catch(() => {});
await page.fill('textarea[aria-label="Message to the assistant"]', 'what did we decide about spending?');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-panel .chat-sources');
const wire2 = chatCalls.at(-1).messages.at(-1).content;
check('the drawer sent the related passage of ANOTHER page as background', chatCalls.length === alsoBefore + 1 && /\[1\] Planning/.test(wire2) && !/Garden\nPlant tomato/.test(wire2), wire2.slice(0, 160));
check('and told the model they are background, not the only source', /Use them as background/.test(chatCalls.at(-1).messages[0].content));
check('the drawer shows the source it used', (await page.locator('.ai-panel .chat-sources .src:has-text("Planning")').count()) === 1);

/* ---- the index survives a reload: nothing is embedded again ---- */
const docBefore = embedCalls.flat().filter((t) => t.startsWith('search_document')).length;
await page.reload();
await page.waitForTimeout(9000); // long enough for the first background indexing run after start-up
const docAfter = embedCalls.flat().filter((t) => t.startsWith('search_document')).length;
check('after a reload the stored vectors are reused, not made again', docAfter === docBefore, `${docBefore} -> ${docAfter}`);

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
