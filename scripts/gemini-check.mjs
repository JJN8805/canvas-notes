// Gemini as a chat provider and as a picture source, in the real app (browser preview), with Google's servers MOCKED.
// Also: Ollama chat + Gemini pictures together. Run with the dev server up: node scripts/gemini-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
function findChromium() {
  const root = join(homedir(), '.cache', 'ms-playwright');
  for (const d of readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse())
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) if (existsSync(join(root, d, sub))) return join(root, d, sub);
}
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`); };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' && !/status of 4\d\d/.test(m.text()) ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push('exception: ' + e.message));

const calls = [];
let mode = 'ok';
await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const url = req.url();
  calls.push({ url, headers: req.headers(), body: req.postData() ?? '' });
  const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (mode === 'badkey') return json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
  if (url.includes(':streamGenerateContent')) {
    const ev = (t, fin) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: t }] }, ...(fin ? { finishReason: 'STOP' } : {}) }] })}\n\n`;
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: ev('Hello from ') + ev('Gemini.', true) });
  }
  if (url.includes(':generateContent')) {
    if (mode === 'refuse') return json(200, { candidates: [{ content: { parts: [{ text: 'I can’t draw that.' }] } }] });
    return json(200, { candidates: [{ content: { parts: [{ text: 'Here it is' }, { inlineData: { mimeType: 'image/png', data: PNG } }] } }] });
  }
  return json(404, { error: { message: 'not mocked' } });
});
// Ollama is mocked too, to prove chat and pictures can come from different places
const ollama = [];
await page.route('http://localhost:11434/api/chat', async (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  ollama.push(JSON.parse(route.request().postData()));
  const lines = [JSON.stringify({ message: { content: 'Hi from Ollama' }, done: false }), JSON.stringify({ message: { content: '' }, done: true })];
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/x-ndjson' }, body: lines.join('\n') + '\n' });
});

await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('text=Open an example page');
await page.waitForSelector('.block');
await page.click('.ed-back');
await page.click('.sidebar >> text=Settings');
await page.click('[role=tab]:has-text("Add-ons")');
await page.click('button[role=switch]:has-text("Turn on AI assistant")');
await page.waitForSelector('select[aria-label="AI provider"]');
const providers = await page.locator('select[aria-label="AI provider"] option').allInnerTexts();
check('Gemini is offered next to Ollama, Claude and ChatGPT', ['Ollama', 'Claude (Anthropic)', 'ChatGPT (OpenAI)', 'Gemini (Google)'].every((p) => providers.includes(p)), providers.join(' | '));

await page.selectOption('select[aria-label="AI provider"]', 'gemini');
check('choosing Gemini says it is a cloud destination and explains where to get a key', /company’s servers/.test(await page.locator('.ai-note.dest-cloud').first().innerText()) && /aistudio\.google\.com\/apikey/.test(await page.locator('.ai-settings').innerText()) && /doesn’t include one/.test(await page.locator('.ai-settings').innerText()));
check('the model starts as a Gemini model', (await page.inputValue('input[aria-label="Model name"]')) === 'gemini-2.5-flash');
await page.screenshot({ path: '/tmp/gemini-settings.png' });
// no key yet
await page.click('button:has-text("Test (sends one short message)")');
await page.waitForFunction(() => /No API key/.test(document.querySelector('.ai-settings')?.textContent ?? ''));
check('with no key saved, Test says so and sends nothing', calls.length === 0);
await page.fill('input[aria-label="Gemini (Google) API key"]', 'AIzaFAKE-test_key123');
await page.click('button:has-text("Save key")');
await page.waitForFunction(() => /Saved/.test(document.querySelector('.ai-key')?.textContent ?? ''));
await page.click('button:has-text("Test (sends one short message)")');
await page.waitForFunction(() => /It works/.test(document.querySelector('.ai-settings')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
const t = calls.at(-1);
check('Test reaches Gemini’s streaming endpoint with the key in a header, not the address or the body', t && /v1beta\/models\/gemini-2\.5-flash:streamGenerateContent\?alt=sse$/.test(t.url) && t.headers['x-goog-api-key'] === 'AIzaFAKE-test_key123' && !t.url.includes('AIza') && !t.body.includes('AIza'), JSON.stringify(t?.headers));
check('and it works', /It works/.test(await page.locator('.ai-settings').innerText()));
// wrong key
mode = 'badkey';
await page.click('button:has-text("Test (sends one short message)")');
await page.waitForFunction(() => /rejected the API key/.test(document.querySelector('.ai-settings')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
check('a wrong key is reported plainly', /Gemini \(Google\) rejected the API key/.test(await page.locator('.ai-settings').innerText()));
mode = 'ok';

// pictures from Gemini
await page.selectOption('select[aria-label="Picture source"]', 'gemini');
check('Gemini is a picture source, with its own model box and a billing note', (await page.inputValue('input[aria-label="Gemini picture model"]')) === 'gemini-2.5-flash-image' && /billing/.test(await page.locator('.ai-settings').innerText()));
check('the picture note says Google’s servers', /Google’s servers/.test(await page.locator('.ai-note.dest-cloud').last().innerText()));
await page.screenshot({ path: '/tmp/gemini-pictures-settings.png' });
await page.keyboard.press('Escape');

// chat in the drawer with Gemini
await page.click('text=Canvas basics').catch(() => {});
await page.waitForSelector('.block');
await page.click('button:has-text("Assistant")');
await page.waitForSelector('.ai-panel');
check('the drawer names Gemini and the cloud', /Gemini/.test(await page.locator('.ai-sub').innerText()) && (await page.locator('.ai-badge.dest-cloud').count()) === 1);
await page.fill('textarea[aria-label="Message to the assistant"]', 'Say hello');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-confirm', { timeout: 5000 }).catch(() => {});
check('a cloud model shows what will be sent and asks first (the page is attached)', (await page.locator('.ai-confirm').count()) === 1 && /Send this to Gemini/.test(await page.locator('.ai-confirm').innerText()));
await page.screenshot({ path: '/tmp/gemini-confirm.png' });
const before = calls.length;
check('nothing was sent before the click', calls.length === before);
await page.click('.ai-confirm button.primary');
await page.waitForFunction(() => /Hello from Gemini\./.test(document.querySelector('.ai-list')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
const chat = calls.at(-1);
const parsed = JSON.parse(chat.body);
check('the streamed answer appears', /Hello from Gemini\./.test(await page.locator('.ai-list').innerText()));
check('the request has the system text, the page and the question, in Gemini’s format', parsed.systemInstruction?.parts?.[0]?.text?.length > 20 && parsed.contents.at(-1).role === 'user' && /<page>/.test(parsed.contents.at(-1).parts[0].text) && /Say hello/.test(parsed.contents.at(-1).parts[0].text));
// the page-edit proposal flow also works through Gemini (labels come from the page text)
check('the edit instructions went along, since suggesting changes is on', /NOT made when you answer/.test(parsed.systemInstruction.parts[0].text));

// a picture from Gemini, in the drawer
await page.check('.ai-panel label:has-text("Draw a picture instead") input');
check('the picture toggle names where it goes', /Google Gemini \(gemini-2\.5-flash-image\)/.test(await page.locator('.ai-panel label:has-text("Draw a picture")').innerText()));
await page.fill('textarea[aria-label="Message to the assistant"]', 'a red ball');
await page.keyboard.press('Enter');
await page.waitForSelector('img.ai-img', { timeout: 8000 }).catch(() => {});
const img = calls.at(-1);
check('the picture request goes to the image model with only the typed description', /models\/gemini-2\.5-flash-image:generateContent$/.test(img.url) && JSON.parse(img.body).contents[0].parts[0].text === 'a red ball' && !/Hello|Canvas/.test(img.body) && img.headers['x-goog-api-key'] === 'AIzaFAKE-test_key123');
check('and the picture shows in the chat', (await page.locator('img.ai-img').count()) === 1);
await page.screenshot({ path: '/tmp/gemini-picture.png' });
await page.click('.ai-msg:has(img.ai-img) button:has-text("Add to page")');
await page.waitForTimeout(600);
check('Add to page puts the picture on the page', (await page.locator('.block img').count()) >= 1);

// a refusal is explained
mode = 'refuse';
await page.fill('textarea[aria-label="Message to the assistant"]', 'something forbidden');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-error', { timeout: 8000 }).catch(() => {});
check('when Gemini answers in words instead of a picture, the words are shown', /didn’t draw a picture.*can’t draw that/.test(await page.locator('.ai-error').last().innerText().catch(() => '')));
mode = 'ok';

// Ollama for chat + Gemini for pictures
await page.click('button[aria-label="Close assistant"], .ai-panel button:has-text("Close")');
await page.click('.ed-back');
await page.click('.sidebar >> text=Settings');
await page.click('[role=tab]:has-text("Add-ons")');
await page.selectOption('select[aria-label="AI provider"]', 'ollama');
await page.fill('[aria-label="Ollama model"]', 'mock:1b');
await page.keyboard.press('Escape');
await page.click('text=Canvas basics');
await page.waitForSelector('.block');
await page.click('button:has-text("Assistant")');
await page.waitForSelector('.ai-panel');
const g0 = calls.length;
await page.fill('textarea[aria-label="Message to the assistant"]', 'Say hi');
await page.keyboard.press('Enter');
await page.waitForFunction(() => /Hi from Ollama/.test(document.querySelector('.ai-list')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
check('with Ollama chosen for chat, answers come from Ollama and nothing goes to Google', /Hi from Ollama/.test(await page.locator('.ai-list').innerText()) && calls.length === g0 && ollama.length === 1);
check('and the picture toggle is still offered, naming Gemini', /Google Gemini/.test(await page.locator('.ai-panel label:has-text("Draw a picture")').innerText()));
await page.check('.ai-panel label:has-text("Draw a picture instead") input');
await page.fill('textarea[aria-label="Message to the assistant"]', 'a blue cube');
await page.keyboard.press('Enter');
await page.waitForFunction((n) => document.querySelectorAll('img.ai-img').length >= n, 2, { timeout: 8000 }).catch(() => {});
check('Ollama for chat and Gemini for pictures work side by side', calls.length === g0 + 1 && /generateContent$/.test(calls.at(-1).url) && ollama.length === 1);

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 4).join(' || '));
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} checks passed.`);
process.exit(bad ? 1 : 0);
