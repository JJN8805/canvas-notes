// End-to-end checks of the add-ons in headless Chromium against the running dev app (`npm run dev`).
//   chat:   the REAL local Ollama (needs a model; set OLLAMA_MODEL, default llama3.2:latest)
//   cloud:  Claude and OpenAI are MOCKED with page.route, so what would be sent can be inspected (no real key is used)
//   OCR:    the vision model is MOCKED (a vision model is not installed everywhere)
// Prints PASS/FAIL per check; exits 1 if any fail.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:latest';
const OUT = join(tmpdir(), 'canvas-addons-check');
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
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const errors = [];
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' ? errors.push(m.text().slice(0, 220)) : 0));
  page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));
  return { ctx, page };
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const sse = (...events) => events.join('');
const settingsTab = async (page, tab) => {
  await page.click('.side-settings');
  await page.click(`[role=tab]:has-text("${tab}")`);
};
const toggleAddon = (page, name) => page.click(`button[role=switch]:has-text("Turn on ${name}")`);

/* ---------- 0. off means off: nothing of an add-on is even downloaded ---------- */
let { ctx, page } = await newPage();
const requested = [];
page.on('request', (r) => requested.push(r.url()));
await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('text=Open an example page');
await page.waitForSelector('.block');
check('with add-ons off there is no Assistant button', (await page.locator('button:has-text("Assistant")').count()) === 0);
check('with add-ons off no add-on code is downloaded', !requested.some((u) => /\/addons\/(ai|ocr)\//.test(u)), requested.filter((u) => /addons/.test(u)).join(', '));
await page.click('.ed-back');
await settingsTab(page, 'Add-ons');
check('Settings has an Add-ons section listing both add-ons, off', (await page.locator('button[role=switch]').count()) >= 2 && (await page.locator('button[role=switch][aria-checked=true]').count()) === 0);
await page.screenshot({ path: join(OUT, 'addons-off.png') });

/* ---------- 1. turn on the assistant; real Ollama ---------- */
await toggleAddon(page, 'AI assistant');
await page.waitForSelector('[aria-label="AI provider"]');
check('turning it on loads its settings, with Ollama on this computer the default', (await page.locator('[aria-label="AI provider"]').inputValue()) === 'ollama' && (await page.locator('.ai-note.dest-local').count()) === 1);
check('its code is downloaded only now', requested.some((u) => /\/addons\/ai\//.test(u)));
await page.click('button:has-text("Find models")');
await page.waitForSelector('text=/Found \\d+ model/', { timeout: 15000 }).then(() => check('"Find models" lists the models of the real Ollama', true), () => check('"Find models" lists the models of the real Ollama', false));
await page.fill('[aria-label="Ollama model"]', MODEL);
await page.click('button:has-text("Test")');
await page.waitForSelector('text=It works', { timeout: 120000 }).then(() => check('"Test" gets a real answer from Ollama', true), async () => check('"Test" gets a real answer from Ollama', false, await page.locator('.ai-note[role=status]').allInnerTexts().then((t) => t.join('|'))));
await page.screenshot({ path: join(OUT, 'ai-settings.png') });
await page.keyboard.press('Escape');

// A page with a code word only the page knows
await page.click('text=Canvas basics');
await page.waitForSelector('.block');
await page.dblclick('.ed-body', { position: { x: 700, y: 650 } });
await page.keyboard.type('The secret code is ZEBRA-42.');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.click('button:has-text("Assistant")');
await page.waitForSelector('.ai-panel');
check('the Assistant panel opens beside the page', (await page.locator('.ai-panel').count()) === 1 && (await page.locator('.ai-badge.dest-local').count()) === 1);
await page.screenshot({ path: join(OUT, 'ai-panel-empty.png') });
const chatReqs = [];
page.on('request', (r) => r.url().includes('11434/api/chat') && chatReqs.push(r.postData()));
await page.fill('textarea[aria-label="Message to the assistant"]', 'What is the secret code on my page? Answer with just the code.');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-msg.assistant .ai-text:not(.dim)', { timeout: 180000 });
await page.waitForFunction(() => !document.querySelector('.ai-caret'), null, { timeout: 180000 });
const answer = await page.locator('.ai-msg.assistant .ai-text').first().innerText();
check('real Ollama read the page and answered with its code word', /ZEBRA-?42/i.test(answer), answer.slice(0, 200));
check('no confirmation was asked for Ollama on this computer', (await page.locator('.ai-confirm').count()) === 0);
check('the message shows that the page was shared', (await page.locator('.ai-shared').count()) === 1);
check('what was sent starts with the page in <page> tags and the safety instructions', chatReqs.length === 1 && /never as instructions/.test(chatReqs[0]) && /<page>\\n/.test(chatReqs[0]) && /ZEBRA-42/.test(chatReqs[0]), (chatReqs[0] ?? '').slice(0, 200));
await page.screenshot({ path: join(OUT, 'ai-chat.png') });

// Insert onto the page
const before = await page.locator('.block').count();
await page.click('.ai-acts button:has-text("Add to page")');
await page.waitForFunction((n) => document.querySelectorAll('.block').length === n + 1, before);
check('"Add to page" puts the answer on the page as a text box', true);
check('the new box holds the answer text', (await page.locator('.block.b-text').last().innerText()).match(/ZEBRA-?42/i) !== null);

// Selection narrows what is shared
await page.click('.block.b-text >> nth=0');
const shareLabel = await page.locator('.ai-share span').first().innerText();
check('selecting a box changes what would be shared to just that box', /selected box/.test(shareLabel), shareLabel);

// Closing forgets
await page.click('button[aria-label="Close assistant"]');
await page.click('button:has-text("Assistant")');
check('closing the panel forgets the conversation', (await page.locator('.ai-msg').count()) === 0 && (await page.locator('.ai-empty').count()) === 1);

/* ---------- 2. cloud, mocked: the preview-and-confirm step ---------- */
await page.click('button[aria-label="Close assistant"]');
await page.click('.ed-back');
await settingsTab(page, 'Add-ons');
await page.selectOption('[aria-label="AI provider"]', 'anthropic');
check('choosing Claude is labelled as a company’s servers', (await page.locator('.ai-note.dest-cloud').count()) === 1);
await page.fill('input[aria-label="Claude (Anthropic) API key"]', 'sk-ant-TEST-1234');
await page.click('button:has-text("Save key")');
await page.waitForSelector('text=Key saved');
check('the key field is masked and the key is not shown after saving', (await page.locator('input[aria-label="Claude (Anthropic) API key"]').getAttribute('type')) === 'password' && !(await page.content()).includes('sk-ant-TEST-1234'));
const anthropicCalls = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  anthropicCalls.push({ headers: req.headers(), body: req.postData() });
  await route.fulfill({
    status: 200, headers: { ...cors, 'content-type': 'text/event-stream' },
    body: sse(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"The code is "}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ZEBRA-42."}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ),
  });
});
await page.keyboard.press('Escape');
await page.click('text=Canvas basics');
await page.waitForSelector('.block');
await page.click('button:has-text("Assistant")');
await page.waitForSelector('.ai-panel');
check('the badge says Cloud', (await page.locator('.ai-badge.dest-cloud').count()) === 1);
await page.fill('textarea[aria-label="Message to the assistant"]', 'What is the code?');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-confirm');
const preview = await page.locator('.ai-preview[aria-label="The message"]').innerText();
check('before anything is sent, the exact message with the page text is shown', /<page>/.test(preview) && /ZEBRA-42/.test(preview) && /What is the code\?/.test(preview));
check('nothing has been sent while the question is open', anthropicCalls.length === 0);
await page.screenshot({ path: join(OUT, 'ai-confirm.png') });
await page.click('button:has-text("Don’t send")');
await page.waitForTimeout(400);
check('"Don’t send" sends nothing and starts no chat', anthropicCalls.length === 0 && (await page.locator('.ai-msg').count()) === 0);
await page.keyboard.press('Enter').catch(() => {});
await page.fill('textarea[aria-label="Message to the assistant"]', 'What is the code?');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-confirm');
await page.click('.ai-confirm button.primary');
await page.waitForSelector('.ai-msg.assistant .ai-text:has-text("ZEBRA-42.")', { timeout: 15000 }).then(() => check('after "Send" the streamed answer appears', true), () => check('after "Send" the streamed answer appears', false));
check('Claude was called once, with the key in its header and the page in the body', anthropicCalls.length === 1 && anthropicCalls[0].headers['x-api-key'] === 'sk-ant-TEST-1234' && /ZEBRA-42/.test(anthropicCalls[0].body) && JSON.parse(anthropicCalls[0].body).stream === true, JSON.stringify(anthropicCalls[0]?.headers ?? {}).slice(0, 200));
check('the request used the Claude messages API and the chosen model', JSON.parse(anthropicCalls[0].body).model === 'claude-sonnet-5-5' && typeof JSON.parse(anthropicCalls[0].body).system === 'string');
// a follow-up with no new page text does not ask again
await page.uncheck('.ai-share input >> nth=0');
await page.fill('textarea[aria-label="Message to the assistant"]', 'Thanks!');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('.ai-msg.assistant').length === 2, null, { timeout: 15000 });
check('a follow-up to the same provider, with no page attached, does not ask again', (await page.locator('.ai-confirm').count()) === 0 && anthropicCalls.length === 2);
// switching provider mid-chat: the page text in the history would go along, so it asks again
await page.click('button[aria-label="Close assistant"]');
await page.click('.ed-back');
await settingsTab(page, 'Add-ons');
await page.selectOption('[aria-label="AI provider"]', 'openai');
await page.fill('input[aria-label="ChatGPT (OpenAI) API key"]', 'sk-openai-TEST-5678');
await page.click('button:has-text("Save key")');
const openaiCalls = [];
await page.route('https://api.openai.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (req.url().includes('/images/generations')) {
    openaiCalls.push({ url: req.url(), body: req.postData(), headers: req.headers() });
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }) });
  }
  openaiCalls.push({ url: req.url(), body: req.postData(), headers: req.headers() });
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse('data: {"choices":[{"delta":{"content":"Hello from "}}]}\n\n', 'data: {"choices":[{"delta":{"content":"OpenAI"}}]}\n\n', 'data: [DONE]\n\n') });
});
await page.keyboard.press('Escape');
await page.click('text=Canvas basics');
await page.waitForSelector('.block');
await page.click('button:has-text("Assistant")');
// a fresh chat (history was forgotten when the panel closed): ask with the page
await page.fill('textarea[aria-label="Message to the assistant"]', 'Hello');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-confirm');
check('OpenAI also asks before the page is sent', true);
await page.click('.ai-confirm button.primary');
await page.waitForSelector('.ai-msg.assistant .ai-text:has-text("Hello from OpenAI")', { timeout: 15000 }).then(() => check('OpenAI’s streamed answer is shown', true), () => check('OpenAI’s streamed answer is shown', false));
check('OpenAI got the bearer key and the chat-completions request', openaiCalls[0]?.headers.authorization === 'Bearer sk-openai-TEST-5678' && openaiCalls[0].url.endsWith('/v1/chat/completions'));
// pictures
await page.check('text=Draw a picture instead of answering');
await page.fill('textarea[aria-label="Message to the assistant"]', 'a red fox');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-img', { timeout: 15000 }).then(() => check('a generated picture is shown in the chat', true), () => check('a generated picture is shown in the chat', false));
const img = openaiCalls.find((c) => c.url.includes('images'));
check('the picture request went to OpenAI images with only the typed prompt', img && JSON.parse(img.body).prompt === 'a red fox' && !/ZEBRA/.test(img.body));
const nImages = await page.locator('.block.b-image').count();
await page.click('.ai-msg:has(.ai-img) .ai-acts button:has-text("Add to page")');
await page.waitForFunction((n) => document.querySelectorAll('.block.b-image').length === n + 1, nImages, { timeout: 10000 }).then(() => check('"Add to page" puts the generated picture on the page as a picture box', true), () => check('"Add to page" puts the generated picture on the page as a picture box', false));
await page.screenshot({ path: join(OUT, 'ai-image.png') });

/* ---------- 3. errors read well ---------- */
await page.unroute('https://api.openai.com/**');
await page.route('https://api.openai.com/**', (route) => (route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: '{"error":{"message":"Incorrect API key provided"}}' })));
await page.uncheck('text=Draw a picture instead of answering');
await page.uncheck('.ai-share input >> nth=0');
await page.fill('textarea[aria-label="Message to the assistant"]', 'again');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-error', { timeout: 15000 });
check('a rejected key reads as a plain message pointing at Settings', /rejected the API key.*Settings/.test(await page.locator('.ai-error').first().innerText()));
await page.screenshot({ path: join(OUT, 'ai-error.png') });
await page.click('button[aria-label="Close assistant"]');

/* ---------- 4. OCR (mock vision model) ---------- */
await page.click('.ed-back');
await settingsTab(page, 'Add-ons');
await toggleAddon(page, 'Text from pictures \\(OCR\\)').catch(async () => page.click('button[role=switch]:has-text("OCR")'));
await page.waitForSelector('[aria-label="Vision model"]');
await page.fill('[aria-label="Ollama address for OCR"]', 'http://192.168.1.50:11434');
check('OCR refuses an Ollama address that is not on this computer, in plain words', /never leave it/.test(await page.locator('.ai-note[role=alert]').innerText()));
await page.fill('[aria-label="Ollama address for OCR"]', 'http://localhost:11434');
await page.fill('[aria-label="Vision model"]', 'llama3.2-vision');
await page.keyboard.press('Escape');
await page.click('text=Canvas basics');
await page.waitForSelector('.block');
await page.setInputFiles('input[accept="image/*"]', { name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
await page.waitForSelector('.block.b-image');
const ocrCalls = [];
await page.route('http://localhost:11434/api/chat', (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  ocrCalls.push(JSON.parse(route.request().postData()));
  return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: { role: 'assistant', content: 'INVOICE 2024-117\nTotal 99.10' }, done: true }) });
});
await page.locator('.block.b-image').last().hover();
const extractBtn = page.locator('.block.b-image').last().locator('button[aria-label="Extract text"]');
check('a picture box gets an "Extract text" button while OCR is on', (await extractBtn.count()) === 1);
await extractBtn.click();
await page.waitForSelector('text=Found 28 characters', { timeout: 15000 }).then(() => check('extracting reports how much text it found', true), async () => check('extracting reports how much text it found', false, await page.locator('.toast, [role=status]').allInnerTexts().then((t) => t.join('|'))));
check('the picture, the model and the instruction were sent to local Ollama', ocrCalls.length === 1 && ocrCalls[0].model === 'llama3.2-vision' && ocrCalls[0].messages[0].images?.length === 1 && ocrCalls[0].stream === false);
await page.locator('.block.b-image').last().hover();
check('the button now offers to re-read, copy and clear the text', (await page.locator('.block.b-image').last().locator('button[aria-label="Re-read text"], button[aria-label="Copy text"], button[aria-label="Clear text"]').count()) === 3);
await page.waitForTimeout(600);
await page.click('.ed-back');
await page.waitForSelector('.sidebar');
await page.fill('input[aria-label="Search pages"]', 'invoice 117');
await page.waitForTimeout(300);
check('search finds the page by the text that was inside the picture', (await page.locator('text=No pages match your search').count()) === 0 && (await page.locator('.library .main >> text=Canvas basics').count()) > 0);
await page.fill('input[aria-label="Search pages"]', 'zzzunrelated');
await page.waitForTimeout(300);
check('and an unrelated word still finds nothing', (await page.locator('text=No pages match your search').count()) === 1);
await page.fill('input[aria-label="Search pages"]', '');

/* ---------- 4b. a card's picture from AI (OpenAI mocked) ---------- */
await page.unroute('https://api.openai.com/**');
const cardImageCalls = [];
await page.route('https://api.openai.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  cardImageCalls.push({ url: req.url(), body: req.postData(), headers: req.headers() });
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }) });
});
await page.click('.sidebar >> text=Cards');
await page.click('button:has-text("New card")');
await page.waitForSelector('.card-detail');
await page.fill('.cd-label', 'Garden');
await page.click('.cd-body .ProseMirror');
await page.keyboard.type('Tomatoes and basil. Private diary details.');
const genBtn = page.locator('.cd-cover-actions button:has-text("Generate with AI")');
check('with the add-on on, a card offers "Generate with AI" beside "Add picture"', (await genBtn.count()) === 1 && (await page.locator('.cd-cover-actions button:has-text("Add picture")').count()) === 1);
await page.screenshot({ path: join(OUT, 'card-buttons.png') });
await genBtn.click();
await page.waitForSelector('[aria-label="Generate a picture with AI"]');
check('the dialog starts from the card’s label', (await page.locator('textarea[aria-label="Describe the picture"]').inputValue()) === 'A picture for a card titled “Garden”');
check('it says plainly that this text is sent to OpenAI', /sent to OpenAI/.test(await page.locator('[aria-label="Generate a picture with AI"]').innerText()));
await page.fill('textarea[aria-label="Describe the picture"]', 'a watercolour of a tomato garden');
check('nothing is sent until Generate is clicked', cardImageCalls.length === 0);
await page.click('[aria-label="Generate a picture with AI"] button:has-text("Generate")');
await page.waitForSelector('img.cd-gen', { timeout: 15000 });
check('the generated picture is previewed before it is used', true);
check('only the typed description went to OpenAI (none of the card’s details)', cardImageCalls.length === 1 && JSON.parse(cardImageCalls[0].body).prompt === 'a watercolour of a tomato garden' && !/diary|basil|Tomatoes/i.test(cardImageCalls[0].body) && !/titled/.test(cardImageCalls[0].body) && cardImageCalls[0].headers.authorization === 'Bearer sk-openai-TEST-5678');
await page.screenshot({ path: join(OUT, 'card-generate.png') });
await page.click('[aria-label="Generate a picture with AI"] button:has-text("Try again")');
await page.waitForFunction(() => document.querySelector('img.cd-gen'), null, { timeout: 15000 });
check('"Try again" asks again', cardImageCalls.length === 2);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape closes just the picture dialog, not the card', (await page.locator('[aria-label="Generate a picture with AI"]').count()) === 0 && (await page.locator('.card-detail').count()) === 1);
check('and nothing was set as the cover by closing it', (await page.locator('.cd-cover img').count()) === 0);
// Escape while it is drawing stops the drawing but keeps the dialog (a slow answer is mocked so there is time to press it)
await page.unroute('https://api.openai.com/**');
let slowHit = 0;
await page.route('https://api.openai.com/**', async (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  slowHit++;
  await new Promise((r) => setTimeout(r, 3000));
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }) }).catch(() => {});
});
await genBtn.click();
await page.fill('textarea[aria-label="Describe the picture"]', 'something slow');
await page.click('[aria-label="Generate a picture with AI"] button:has-text("Generate")');
await page.waitForSelector('text=Drawing…');
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.body.innerText.includes('Drawing…'), null, { timeout: 5000 }).then(() => check('Escape while drawing stops it', true), () => check('Escape while drawing stops it', false));
await page.waitForTimeout(3500);
check('...keeps the dialog open, with no picture and no error from the stopped request', (await page.locator('[aria-label="Generate a picture with AI"]').count()) === 1 && (await page.locator('img.cd-gen').count()) === 0 && (await page.locator('.ai-error').count()) === 0 && slowHit === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.unroute('https://api.openai.com/**');
await page.route('https://api.openai.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  cardImageCalls.push({ url: req.url(), body: req.postData(), headers: req.headers() });
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }) });
});
await genBtn.click();
await page.fill('textarea[aria-label="Describe the picture"]', 'a red fox');
await page.click('[aria-label="Generate a picture with AI"] button:has-text("Generate")');
await page.waitForSelector('img.cd-gen', { timeout: 15000 });
await page.click('button:has-text("Use this picture")');
await page.waitForSelector('.cd-cover img', { timeout: 10000 }).then(() => check('"Use this picture" makes it the card’s cover', true), () => check('"Use this picture" makes it the card’s cover', false));
check('the picture dialog closed and the button now says "Change picture"', (await page.locator('[aria-label="Generate a picture with AI"]').count()) === 0 && (await page.locator('.cd-cover-actions button:has-text("Change picture")').count()) === 1);
await page.screenshot({ path: join(OUT, 'card-with-ai-cover.png') });
await page.click('.card-detail button:has-text("Done")');
check('the card tile in the gallery shows the new picture', (await page.locator('.ctile .ctile-cover img').count()) >= 1);
await page.screenshot({ path: join(OUT, 'cards-gallery.png') });

/* ---------- 5. it all survives a reload, and off means off again ---------- */
await page.reload();
await page.waitForSelector('.sidebar');
await page.click('text=Canvas basics');
await page.waitForSelector('.block');
await page.waitForSelector('button:has-text("Assistant")', { timeout: 10000 }).then(() => check('after a reload the add-ons are still on and the assistant is back', true), () => check('after a reload the add-ons are still on and the assistant is back', false));
await page.locator('.block.b-image').last().hover();
check('the text read from the picture is still stored after a reload (the button offers "Re-read text")', (await page.locator('.block.b-image').last().locator('button[aria-label="Re-read text"]').count()) === 1);
await page.click('.ed-back');
await settingsTab(page, 'Add-ons');
await toggleAddon(page, 'AI assistant');
await page.keyboard.press('Escape');
await page.click('text=Canvas basics');
await page.waitForSelector('.block');
check('switching the assistant off removes its button at once', (await page.locator('button:has-text("Assistant")').count()) === 0);
await ctx.close();

/* ---------- 6. off means no button; on without a key explains what is needed ---------- */
({ ctx, page } = await newPage());
await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('.sidebar >> text=Cards');
await page.click('button:has-text("New card")');
await page.waitForSelector('.card-detail');
check('with the AI add-on off a card has no "Generate with AI" button, only the usual ones', (await page.locator('.cd-cover-actions button:has-text("Generate with AI")').count()) === 0 && (await page.locator('.cd-cover-actions button:has-text("Add picture")').count()) === 1);
await page.click('.card-detail button:has-text("Done")');
await settingsTab(page, 'Add-ons');
await toggleAddon(page, 'AI assistant');
await page.waitForSelector('[aria-label="AI provider"]');
await page.keyboard.press('Escape');
await page.click('.ctile >> nth=0');
await page.waitForSelector('.card-detail');
await page.click('.cd-cover-actions button:has-text("Generate with AI")');
await page.waitForSelector('[aria-label="Generate a picture with AI"]');
const keyText = await page.locator('[aria-label="Generate a picture with AI"]').innerText();
check('switching it on adds the button; with no key the dialog says a key is needed', /needs your API key/.test(keyText) && (await page.locator('textarea[aria-label="Describe the picture"]').count()) === 0, keyText.slice(0, 160));
await page.screenshot({ path: join(OUT, 'card-no-key.png') });
await page.click('button:has-text("Open settings")');
await page.waitForSelector('[role=tab]:has-text("Add-ons")');
// Settings must be on top of the card, not hidden behind it: a trial click fails if something else covers the tab.
const reachable = await page.locator('[role=tab]:has-text("Add-ons")').click({ trial: true, timeout: 3000 }).then(() => true, () => false);
check('"Open settings" shows Settings on top, where it can be used', reachable);
await page.screenshot({ path: join(OUT, 'card-open-settings.png') });
await ctx.close();

// The one 401 is the deliberately mocked "bad key" answer; the browser always logs a failed request.
const real = errors.filter((e) => !/status of 401/.test(e));
check('no console errors or exceptions (apart from the mocked 401)', real.length === 0, real.slice(0, 5).join(' || '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
