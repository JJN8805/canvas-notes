// End-to-end checks of the add-ons in headless Chromium against the running dev app (`npm run dev`).
//   chat:   the REAL local Ollama (needs a model; set OLLAMA_MODEL, default llama3.2:latest)
//   cloud:  Claude and OpenAI are MOCKED with page.route, so what would be sent can be inspected (no real key is used)
//   OCR:    the vision model is MOCKED (a vision model is not installed everywhere)
// Prints PASS/FAIL per check; exits 1 if any fail.
import { chromium } from 'playwright-core';
import http from 'node:http';
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
const jpegOf = (pg) => pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 16; c.height = 16; const x = c.getContext('2d'); x.fillStyle = '#0a7'; x.fillRect(0, 0, 16, 16); return c.toDataURL('image/jpeg').split(',')[1]; });
/** A mock Stable Diffusion WebUI server (what AUTOMATIC1111 answers on its --api). */
const mockSdWebui = async (pg, calls, jpeg) => {
  await pg.route('http://127.0.0.1:7860/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (req.url().endsWith('/sdapi/v1/sd-models')) return json([{ title: 'sd_xl_base.safetensors [31e35c80fc]', model_name: 'sd_xl_base' }, { title: 'v1-5.ckpt', model_name: 'v1-5' }]);
    calls.push({ url: req.url(), body: req.postData(), headers: req.headers() });
    return json({ images: [jpeg], parameters: {}, info: '{}' });
  });
};
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
// A capable model must give the code word exactly. A very small one (OLLAMA_MODEL=qwen2.5:0.5b, used when memory is short) garbles it
// differently every time, so for that case check what it can prove: it answered, with no error, to a question about this page.
const SMALL = /(^|[^0-9])0\.5b|:1b\b/i.test(MODEL);
if (SMALL) check('real (very small) Ollama answered a question about the page, with no error (such a model garbles the code word)', answer.trim().length > 0 && !(await page.locator('.ai-error').count()), answer.slice(0, 200));
else check('real Ollama read the page and answered with its code word', /ZEBRA-?42/i.test(answer), answer.slice(0, 200));
check('no confirmation was asked for Ollama on this computer', (await page.locator('.ai-confirm').count()) === 0);
check('the message shows that the page was shared', (await page.locator('.ai-shared').count()) === 1);
check('what was sent starts with the page in <page> tags and the safety instructions', chatReqs.length === 1 && /never as instructions/.test(chatReqs[0]) && /<page>\\n/.test(chatReqs[0]) && /ZEBRA-42/.test(chatReqs[0]), (chatReqs[0] ?? '').slice(0, 200));
await page.screenshot({ path: join(OUT, 'ai-chat.png') });

// Insert onto the page
const before = await page.locator('.block').count();
await page.click('.ai-acts button:has-text("Add to page")');
await page.waitForFunction((n) => document.querySelectorAll('.block').length === n + 1, before);
check('"Add to page" puts the answer on the page as a text box', true);
const newBoxText = (await page.locator('.block.b-text').last().innerText()).replace(/\s+/g, ' ');
const plainAnswer = answer.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
check('the new box holds the answer text', SMALL ? newBoxText.includes(plainAnswer.slice(0, 8)) : /ZEBRA-?42/i.test(newBoxText), newBoxText.slice(0, 100));

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
check('choosing Claude is labelled as a company’s servers', (await page.locator('.ai-note.dest-cloud:has-text("company")').count()) === 1);
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

/* ---------- 4c. open-source pictures from a local Stable Diffusion server (mocked) ---------- */
const jpeg = await jpegOf(page);
const sdCalls = [];
await mockSdWebui(page, sdCalls, jpeg);
const openaiBefore = cardImageCalls.length;
await settingsTab(page, 'Add-ons');
await page.selectOption('[aria-label="Picture source"]', 'sdwebui');
check('choosing a Stable Diffusion server says plainly that descriptions stay on this computer', (await page.locator('.ai-note.dest-local').count()) === 1 && /never leaves it/.test(await page.locator('.ai-note.dest-local').innerText()));
check('the server’s address, model, size and steps can be set (and OpenAI’s picture model is hidden)', (await page.locator('[aria-label="Picture server address"]').inputValue()) === 'http://127.0.0.1:7860' && (await page.locator('[aria-label="Picture model"]').count()) === 0 && (await page.locator('[aria-label="Sampling steps"]').count()) === 1);
await page.click('button:has-text("Check connection")');
await page.waitForSelector('text=Connected. The server lists 2 models', { timeout: 10000 }).then(() => check('"Check connection" lists the server’s models', true), () => check('"Check connection" lists the server’s models', false));
await page.fill('[aria-label="Picture server model"]', 'sd_xl_base');
await page.selectOption('[aria-label="Picture size"]', '768');
await page.screenshot({ path: join(OUT, 'pictures-settings.png') });
await page.keyboard.press('Escape');
await page.click('.sidebar >> text=Cards');
await page.click('.ctile >> nth=0');
await page.waitForSelector('.card-detail');
await page.click('.cd-cover-actions button:has-text("Generate with AI")');
await page.waitForSelector('[aria-label="Generate a picture with AI"]');
const sdText = await page.locator('[aria-label="Generate a picture with AI"]').innerText();
check('the dialog names the local server as the target, not OpenAI', /sent to the Stable Diffusion server at 127\.0\.0\.1:7860 \(on this computer\)/.test(sdText) && !/sent to OpenAI/.test(sdText), sdText.slice(0, 200));
await page.fill('textarea[aria-label="Describe the picture"]', 'a watercolour of a tomato garden');
await page.click('[aria-label="Generate a picture with AI"] button:has-text("Generate")');
await page.waitForSelector('img.cd-gen', { timeout: 15000 });
const shown = await page.locator('img.cd-gen').getAttribute('src');
check('a JPEG answer is previewed as a JPEG', shown.startsWith('data:image/jpeg;base64,'), shown.slice(0, 30));
const sdBody = JSON.parse(sdCalls.find((c) => c.url.endsWith('/txt2img')).body);
check('the server got only the typed description, with the chosen size and model, and was told not to save files', sdBody.prompt === 'a watercolour of a tomato garden' && sdBody.width === 768 && sdBody.height === 768 && sdBody.steps === 20 && sdBody.override_settings?.sd_model_checkpoint === 'sd_xl_base' && sdBody.save_images === false && !/Tomatoes|diary|basil/i.test(JSON.stringify(sdBody)), JSON.stringify(sdBody));
check('nothing at all went to OpenAI, and no key was sent anywhere', cardImageCalls.length === openaiBefore && !sdCalls.some((c) => c.headers.authorization || c.headers['x-api-key']));
await page.click('button:has-text("Use this picture")');
await page.waitForSelector('.cd-cover img', { timeout: 10000 }).then(() => check('a JPEG from the local server becomes the card’s cover', true), () => check('a JPEG from the local server becomes the card’s cover', false));
await page.screenshot({ path: join(OUT, 'card-local-cover.png') });
await page.click('.card-detail button:has-text("Done")');

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

/* ---------- 7. no key anywhere: a local picture server just works, from a card and from the chat ---------- */
({ ctx, page } = await newPage());
const jpeg2 = await jpegOf(page);
const sd2 = [];
await mockSdWebui(page, sd2, jpeg2);
const compat = [];
await page.route('http://localhost:8080/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  compat.push({ url: req.url(), body: req.postData() });
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ b64_json: jpeg2 }] }) });
});
const anyOpenAi = [];
page.on('request', (r) => /api\.openai\.com|api\.anthropic\.com/.test(r.url()) && anyOpenAi.push(r.url()));
await page.goto(URL);
await page.waitForSelector('.sidebar');
await settingsTab(page, 'Add-ons');
await toggleAddon(page, 'AI assistant');
await page.waitForSelector('[aria-label="Picture source"]');
check('a fresh install draws pictures with OpenAI until you choose otherwise', (await page.locator('[aria-label="Picture source"]').inputValue()) === 'openai');
await page.selectOption('[aria-label="Picture source"]', 'sdwebui');
await page.keyboard.press('Escape');
await page.click('.sidebar >> text=Cards');
await page.click('button:has-text("New card")');
await page.waitForSelector('.card-detail');
await page.fill('.cd-label', 'Fox');
await page.click('.cd-cover-actions button:has-text("Generate with AI")');
await page.waitForSelector('textarea[aria-label="Describe the picture"]');
check('with a local server chosen, no API key is asked for', !/needs your API key/.test(await page.locator('[aria-label="Generate a picture with AI"]').innerText()));
check('and the description starts from the card’s label', (await page.locator('textarea[aria-label="Describe the picture"]').inputValue()) === 'A picture for a card titled “Fox”');
await page.click('[aria-label="Generate a picture with AI"] button:has-text("Generate")');
await page.waitForSelector('img.cd-gen', { timeout: 15000 });
await page.click('button:has-text("Use this picture")');
await page.waitForSelector('.cd-cover img');
check('a card gets its picture from a local server with no key at all', sd2.length === 1);
await page.click('.card-detail button:has-text("Done")');
// the other kind of server, from the Assistant, while the chat provider is Ollama
await settingsTab(page, 'Add-ons');
await page.selectOption('[aria-label="Picture source"]', 'imageserver');
check('choosing the OpenAI-compatible server shows its own default address', (await page.locator('[aria-label="Picture server address"]').inputValue()) === 'http://localhost:8080' && (await page.locator('[aria-label="Sampling steps"]').count()) === 0);
await page.keyboard.press('Escape');
await page.click('.sidebar >> text=All pages');
await page.click('text=Open an example page');
await page.waitForSelector('.block');
await page.click('button:has-text("Assistant")');
const drawBox = page.locator('text=Draw a picture instead of answering');
check('the Assistant offers to draw a picture while the chat provider is Ollama, naming your server', (await drawBox.count()) === 1 && /the picture server at localhost:8080 \(on this computer\)/.test(await drawBox.innerText()));
await drawBox.click();
await page.fill('textarea[aria-label="Message to the assistant"]', 'a red fox');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-img', { timeout: 15000 });
check('the picture from the OpenAI-compatible server appears in the chat as a JPEG', (await page.locator('.ai-img').getAttribute('src')).startsWith('data:image/jpeg;base64,'));
const cbody = JSON.parse(compat[0].body);
check('that server was asked for a base64 picture of the right size, with only the typed text', compat[0].url === 'http://localhost:8080/v1/images/generations' && cbody.prompt === 'a red fox' && cbody.size === '512x512' && cbody.response_format === 'b64_json' && cbody.model === undefined, compat[0].body);
const nImg = await page.locator('.block.b-image').count();
await page.click('.ai-msg:has(.ai-img) .ai-acts button:has-text("Add to page")');
await page.waitForFunction((n) => document.querySelectorAll('.block.b-image').length === n + 1, nImg, { timeout: 10000 }).then(() => check('"Add to page" puts it on the page as a picture box', true), () => check('"Add to page" puts it on the page as a picture box', false));
check('in all of this, nothing was ever sent to OpenAI or Anthropic', anyOpenAi.length === 0, anyOpenAi.join(', '));
await page.screenshot({ path: join(OUT, 'pictures-local-chat.png') });
await ctx.close();

/* ---------- 8. Notion-style inline AI: edit selected text, write on an empty line ---------- */
({ ctx, page } = await newPage());
const inlineCalls = [];
let mockOn = false;
let slowMs = 0;
const aiAnswer = (user) => {
  if (/Instruction: Fix the spelling/.test(user)) return 'The quick brown fox jumps over the lazy dog.';
  if (/Instruction: Make this shorter/.test(user)) return 'Fast.';
  if (/Instruction: Summarize/.test(user)) return '- A fox jumps\n- Over a dog';
  if (/make it funnier/.test(user)) return 'A hilarious fox leapt over a very lazy dog.';
  if (/make it rhyme/.test(user)) return 'The fox in socks';
  if (/use an ampersand/.test(user)) return 'Salt & pepper, 3 < 5 and "quotes" <3';
  if (/Find the action items/.test(user)) return '- [ ] Email Sam\n- [ ] Book flights';
  if (/Brainstorm/.test(user)) return '- Idea one\n- Idea two';
  if (/something slow/.test(user)) return 'too late';
  return 'Hello from AI.';
};
await page.route('http://localhost:11434/api/chat', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (!mockOn) return route.continue();
  const body = JSON.parse(req.postData());
  inlineCalls.push(body);
  const user = body.messages.at(-1).content;
  if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
  const text = aiAnswer(user);
  const lines = [...text.match(/.{1,12}/gs)].map((t) => JSON.stringify({ message: { content: t }, done: false }));
  lines.push(JSON.stringify({ message: { content: '' }, done: true }));
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/x-ndjson' }, body: lines.join('\n') + '\n' }).catch(() => {});
});
await page.goto(URL);
await page.waitForSelector('.sidebar');
await settingsTab(page, 'Add-ons');
await toggleAddon(page, 'AI assistant');
await page.waitForSelector('[aria-label="Ollama model"]');
await page.fill('[aria-label="Ollama model"]', MODEL);
await page.keyboard.press('Escape');
await page.click('text=Open an example page');
await page.waitForSelector('.block');
let mineSel = '';
const box = () => page.locator(mineSel).first(); // my text box, found by its id: a model may rewrite its text
const dblSpot = { x: 700, y: 660 };

// an empty text box: the hint, and space opens "Write with AI" without typing a space
await page.dblclick('.ed-body', { position: dblSpot });
await page.waitForSelector('.ProseMirror-focused');
const hint = await page.locator('.ProseMirror-focused .is-empty').first().getAttribute('data-placeholder');
check('an empty text box says "press space for AI"', /press space for AI/.test(hint ?? ''), String(hint));
await page.keyboard.press(' ');
await page.waitForSelector('.ai-card[aria-label="Write with AI"]');
check('space in an empty text box opens "Write with AI"', true);
check('...and no space was typed', (await page.locator('.ProseMirror-focused').first().innerText().catch(() => '')).trim() === '' );
const sugg = await page.locator('.ai-suggestion').allInnerTexts();
check('it suggests five things to write, and has an "Ask AI to write anything" box', sugg.length === 5 && (await page.locator('input[placeholder="Ask AI to write anything…"]').count()) === 1, JSON.stringify(sugg));
await page.screenshot({ path: join(OUT, 'inline-write.png') });
await page.keyboard.press('Escape');
check('Escape closes the card', (await page.locator('.ai-card').count()) === 0);

// type text with typos, select it all, and edit with the REAL local model
await page.click('.ProseMirror-focused').catch(() => {});
await page.keyboard.type('teh quick brown fox jump over the lazy dog');
mineSel = `.block[data-id="${await page.locator('.block:has(.ProseMirror-focused)').getAttribute('data-id')}"] .ProseMirror`;
await page.keyboard.press('Control+a');
await page.click('.fmt button[aria-label="Edit with AI"]');
await page.waitForSelector('.ai-card[aria-label="Edit with AI"]');
const mainLabels = await page.locator('.ai-tasks >> nth=0').locator('button').allInnerTexts();
check('Edit with AI shows six main actions, and the rest are behind "More"', mainLabels.length === 6 && mainLabels[0] === 'Improve writing' && (await page.locator('.ai-card button:has-text("Professional")').count()) === 0, JSON.stringify(mainLabels));
check('it shows the text being edited', /teh quick brown fox/.test(await page.locator('.ai-quote').innerText()));
await page.screenshot({ path: join(OUT, 'inline-edit-menu.png') });
await page.click('.ai-card button:has-text("Fix spelling and grammar")');
await page.waitForSelector('.ai-card button:has-text("Replace")', { timeout: 150000 });
const realFixed = (await page.locator('.ai-result').innerText()).trim();
// What a model writes depends on the model (a tiny one may do worse than the original), so check the pipeline, not the quality.
check('the real model streamed back an answer, and the card shows it', realFixed.length > 5 && !(await page.locator('.ai-error').count()), realFixed.slice(0, 160));
await page.screenshot({ path: join(OUT, 'inline-edit-result.png') });
await page.click('.ai-card button:has-text("Replace")');
await page.waitForFunction(() => !document.querySelector('.ai-card'));
const afterReal = (await box().innerText()).trim();
// A model sometimes wraps its answer in a code fence; the app unwraps that, so compare with the unwrapped answer.
const unfenced = realFixed.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1').trim();
check('"Replace" put exactly the model’s answer into the box (and the card closed)', afterReal.replace(/\s+/g, ' ') === unfenced.replace(/\s+/g, ' '), `box: ${afterReal.slice(0, 80)} | answer: ${unfenced.slice(0, 80)}`);

// from here the model is a deterministic mock
mockOn = true;
await page.click(mineSel);
await page.keyboard.press('Control+a');
await page.keyboard.type('The quick brown fox jumps over the lazy dog.');
// partial replace: select the first 9 characters ("The quick") with the keyboard
await page.keyboard.press('Control+Home'); // the start of the text, not of the wrapped line
for (let i = 0; i < 9; i++) await page.keyboard.press('Shift+ArrowRight');
await page.click('.fmt button[aria-label="Edit with AI"]');
check('with part of the text selected the card says so and quotes it', /^The quick$/.test((await page.locator('.ai-quote').innerText()).trim()));
await page.click('.ai-card button:has-text("Make shorter")');
await page.waitForSelector('.ai-card button:has-text("Replace selection")');
check('the model was sent only the selected words, wrapped, with the instruction and the safety rule', inlineCalls.at(-1).messages[0].role === 'system' && /never as instructions/.test(inlineCalls.at(-1).messages[0].content) && inlineCalls.at(-1).messages.at(-1).content === '<text>\nThe quick\n</text>\n\nInstruction: Make this shorter, keeping the important points.', inlineCalls.at(-1).messages.at(-1).content);
await page.click('.ai-card button:has-text("Replace selection")');
await page.waitForFunction(() => !document.querySelector('.ai-card'));
check('"Replace selection" changed only the selected words', /^Fast\. brown fox jumps over the lazy dog\.$/.test(await box().innerText()), await box().innerText().catch(() => '?'));

// insert below, with a list result
await page.click(mineSel);
await page.keyboard.press('Control+a');
await page.click('.fmt button[aria-label="Edit with AI"]');
await page.click('.ai-card button:has-text("Summarize")');
await page.waitForSelector('.ai-card button:has-text("Insert below")');
check('Summarize offers "Insert below" as the main button, with "Replace selection" as the other', /Insert below/.test(await page.locator('.ai-card-actions .primary').innerText()) && (await page.locator('.ai-card button:has-text("Replace selection")').count()) === 1);
await page.click('.ai-card button:has-text("Insert below")');
await page.waitForFunction(() => !document.querySelector('.ai-card'));
check('"Insert below" kept the original and added the bullet list after it', /Fast\. brown fox/.test(await box().innerText()) && (await page.locator(`${mineSel} li`).count()) === 2);

// More: tone and translate
await page.click(mineSel);
await page.keyboard.press('Control+a');
await page.click('.fmt button[aria-label="Edit with AI"]');
await page.click('.ai-card button:has-text("More…")');
check('"More…" reveals tones and translations (and more actions)', (await page.locator('.ai-card button:has-text("Professional")').count()) === 1 && (await page.locator('.ai-card button:has-text("Hindi")').count()) === 1 && (await page.locator('.ai-card button:has-text("Find action items")').count()) === 1);
await page.screenshot({ path: join(OUT, 'inline-edit-more.png') });
await page.click('.ai-card button:has-text("Hindi")');
await page.waitForSelector('.ai-card button:has-text("Replace")');
check('Translate asks for the language named', /Translate this into Hindi\./.test(inlineCalls.at(-1).messages.at(-1).content));
// refine, then try again, then discard
await page.fill('input[aria-label="Tell AI what to do next"]', 'make it funnier');
await page.press('input[aria-label="Tell AI what to do next"]', 'Enter');
await page.waitForFunction(() => document.querySelector('.ai-result')?.textContent?.includes('hilarious'), null, { timeout: 15000 });
const refineCall = inlineCalls.at(-1).messages;
check('"Tell AI what to do next" continues from the previous result', refineCall.length === 4 && refineCall[2].role === 'assistant' && /make it funnier/.test(refineCall[3].content), JSON.stringify(refineCall.map((m) => m.role)));
const nBefore = inlineCalls.length;
await page.click('.ai-card button:has-text("Try again")');
await page.waitForTimeout(800);
check('"Try again" asks the original request again (not the refinement)', inlineCalls.length === nBefore + 1 && inlineCalls.at(-1).messages.length === 2, `${inlineCalls.length} calls, ${inlineCalls.at(-1).messages.length} messages`);
const textBeforeDiscard = await box().innerText();
await page.click('.ai-card button:has-text("Discard")');
check('"Discard" closes the card and leaves the text untouched', (await page.locator('.ai-card').count()) === 0 && (await box().innerText()) === textBeforeDiscard);

// free-form instruction
await page.click(mineSel);
await page.keyboard.press('Control+a');
await page.click('.fmt button[aria-label="Edit with AI"]');
await page.fill('input[aria-label="Tell AI what to do with this text"]', 'make it rhyme');
await page.press('input[aria-label="Tell AI what to do with this text"]', 'Enter');
await page.waitForSelector('.ai-card button:has-text("Replace")');
check('a free-form instruction is sent as the instruction', /Instruction: make it rhyme$/.test(inlineCalls.at(-1).messages.at(-1).content));
// characters that HTML escapes must come out as themselves when a selection is replaced (they once showed as "&amp;" and "&lt;")
await page.keyboard.press('Escape');
await page.click(mineSel);
await page.keyboard.press('Control+Home');
for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight'); // a selection that is not the whole box
await page.click('.fmt button[aria-label="Edit with AI"]');
await page.fill('input[aria-label="Tell AI what to do with this text"]', 'use an ampersand');
await page.press('input[aria-label="Tell AI what to do with this text"]', 'Enter');
await page.waitForSelector('.ai-card button:has-text("Replace selection")');
await page.click('.ai-card button:has-text("Replace selection")');
await page.waitForFunction(() => !document.querySelector('.ai-card'));
const ampText = await box().innerText();
check('replacing a selection with text containing & < > and quotes shows those characters, not their escapes', ampText.includes('Salt & pepper, 3 < 5 and "quotes" <3') && !/&amp;|&lt;|&gt;|&quot;/.test(ampText), ampText.slice(0, 120));

// Escape while it is writing stops it
slowMs = 3000;
await page.keyboard.press('Escape'); // closes the finished card
await page.click(mineSel);
await page.keyboard.press('Control+a');
await page.click('.fmt button[aria-label="Edit with AI"]');
await page.fill('input[aria-label="Tell AI what to do with this text"]', 'something slow');
await page.press('input[aria-label="Tell AI what to do with this text"]', 'Enter');
await page.waitForSelector('.ai-card button:has-text("Stop")');
const beforeStop = await box().innerText();
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.ai-card button')?.textContent?.includes('Stop') || !document.querySelector('.ai-card'), null, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(3500);
check('Escape while writing stops it: no result is shown and the text is untouched', (await page.locator('.ai-card button:has-text("Replace")').count()) === 0 && (await box().innerText()) === beforeStop);
slowMs = 0;
if (await page.locator('.ai-card').count()) await page.click('.ai-card button[aria-label="Close AI"]');

// write mode: action items as a checklist, a typed prompt into the empty box, and the palette command
await page.dblclick('.ed-body', { position: { x: 300, y: 740 } });
await page.waitForSelector('.ProseMirror-focused');
await page.keyboard.press(' ');
await page.waitForSelector('.ai-card[aria-label="Write with AI"]');
check('Write with AI offers the page as context, with its size', /Use this page as context \(\d[\d,]* characters/.test(await page.locator('.ai-card .ai-share').innerText()));
await page.click('.ai-suggestion:has-text("Find action items")');
await page.waitForSelector('.ai-card button:has-text("Insert as checklist")');
check('the page was sent inside <page> tags with the request (local model, so no question asked)', /<page>\n/.test(inlineCalls.at(-1).messages.at(-1).content) && inlineCalls.at(-1).messages[0].content.includes('Canvas Notes'));
const checklistsBefore = await page.locator('.block.b-checklist').count();
await page.click('.ai-card button:has-text("Insert as checklist")');
await page.waitForFunction((n) => document.querySelectorAll('.block.b-checklist').length === n + 1, checklistsBefore, { timeout: 8000 }).then(() => check('"Insert as checklist" makes a checklist with one item per task', true), () => check('"Insert as checklist" makes a checklist with one item per task', false));
const items = await page.locator('.block.b-checklist').last().locator('textarea').evaluateAll((els) => els.map((e) => e.value));
check('...with the two tasks, one per item', JSON.stringify(items.filter(Boolean)) === JSON.stringify(['Email Sam', 'Book flights']), JSON.stringify(items));
await page.screenshot({ path: join(OUT, 'inline-checklist.png') });
// a typed prompt, inserted into the empty box that asked
await page.click('.ProseMirror-focused').catch(() => {});
await page.dblclick('.ed-body', { position: { x: 300, y: 800 } });
await page.waitForSelector('.ProseMirror-focused');
await page.keyboard.press(' ');
await page.waitForSelector('.ai-card[aria-label="Write with AI"]');
await page.fill('input[aria-label="Ask AI to write anything"]', 'say hello');
await page.press('input[aria-label="Ask AI to write anything"]', 'Enter');
await page.waitForSelector('.ai-card-actions button:has-text("Insert")');
await page.click('.ai-card-actions .primary');
await page.waitForFunction(() => !document.querySelector('.ai-card'));
check('a typed prompt is answered and "Insert" writes it into the empty box', (await page.locator('.block.b-text:has-text("Hello from AI.")').count()) === 1);
// palette command: no text box, so a new one is made
await page.keyboard.press('Escape');
await page.keyboard.press('Control+p');
await page.fill('input[type="text"], input[type="search"]', 'Write with AI').catch(async () => page.keyboard.type('Write with AI'));
await page.waitForSelector('text=Write with AI…', { timeout: 5000 }).catch(() => {});
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-card[aria-label="Write with AI"]', { timeout: 5000 }).then(() => check('the command palette has "Write with AI…"', true), () => check('the command palette has "Write with AI…"', false));
const textBoxesBefore = await page.locator('.block.b-text').count();
await page.fill('input[aria-label="Ask AI to write anything"]', 'say hello');
await page.press('input[aria-label="Ask AI to write anything"]', 'Enter');
await page.waitForSelector('.ai-card-actions button:has-text("Insert")');
await page.click('.ai-card-actions .primary');
await page.waitForFunction((n) => document.querySelectorAll('.block.b-text').length === n + 1, textBoxesBefore, { timeout: 8000 }).then(() => check('from the palette, "Insert" makes a new text box on the page', true), () => check('from the palette, "Insert" makes a new text box on the page', false));

// the Assistant panel: the new quick actions and Try again
await page.click('button:has-text("Assistant")');
const quick = await page.locator('.ai-quick button').allInnerTexts();
check('the Assistant offers Find action items, Continue writing and Brainstorm ideas', ['Find action items', 'Continue writing', 'Brainstorm ideas'].every((q) => quick.includes(q)), JSON.stringify(quick));
await page.click('.ai-quick button:has-text("Brainstorm ideas")');
await page.waitForSelector('.ai-msg.assistant .ai-text:has-text("Idea one")');
const askBefore = inlineCalls.length;
await page.click('.ai-msg.assistant .ai-acts button:has-text("Try again")');
await page.waitForFunction(() => document.querySelectorAll('.ai-msg').length === 2);
await page.waitForTimeout(600);
check('"Try again" in the Assistant asks the same question again and keeps a single answer', inlineCalls.length === askBefore + 1 && (await page.locator('.ai-msg').count()) === 2);
await page.click('button[aria-label="Close assistant"]');

// cloud: the selected text is shown first and nothing is sent until you say so
await page.unroute('http://localhost:11434/api/chat');
await page.click('.ed-back');
await page.waitForSelector('.sidebar');
await settingsTab(page, 'Add-ons');
await page.selectOption('[aria-label="AI provider"]', 'anthropic');
await page.fill('input[aria-label="Claude (Anthropic) API key"]', 'sk-ant-TEST-inline');
await page.click('button:has-text("Save key")');
const claudeCalls = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  claudeCalls.push(JSON.parse(req.postData()));
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Claude says hi."}}\n\n', 'event: message_stop\ndata: {"type":"message_stop"}\n\n') });
});
await page.keyboard.press('Escape');
await page.click('.library .main >> text=Canvas basics');
await page.waitForSelector('.block');
await page.click(mineSel);
await page.keyboard.press('Control+a');
await page.click('.fmt button[aria-label="Edit with AI"]');
check('with Claude chosen the card is labelled Cloud', (await page.locator('.ai-card .ai-badge.dest-cloud').count()) === 1);
await page.click('.ai-card button:has-text("Improve writing")');
await page.waitForSelector('.ai-confirm');
const confirmText = await page.locator('.ai-preview[aria-label="The message"]').innerText();
check('before a cloud model sees your text, the exact message is shown', /<text>/.test(confirmText) && /Salt & pepper/.test(confirmText) && /Instruction: Improve the writing/.test(confirmText));
check('...and nothing has been sent', claudeCalls.length === 0);
await page.click('button:has-text("Don’t send")');
await page.waitForTimeout(400);
check('"Don’t send" sends nothing and leaves the card ready', claudeCalls.length === 0 && (await page.locator('.ai-card').count()) === 1);
await page.click('.ai-card button:has-text("Improve writing")');
await page.waitForSelector('.ai-confirm');
await page.click('.ai-confirm button.primary');
await page.waitForSelector('.ai-result:has-text("Claude says hi.")', { timeout: 15000 }).then(() => check('after "Send" the answer from Claude arrives', true), () => check('after "Send" the answer from Claude arrives', false));
check('Claude got the wrapped text and the editing instructions', claudeCalls.length === 1 && /never as instructions/.test(claudeCalls[0].system) && /<text>\nSalt & pepper/.test(claudeCalls[0].messages[0].content));
await page.fill('input[aria-label="Tell AI what to do next"]', 'shorter please');
await page.press('input[aria-label="Tell AI what to do next"]', 'Enter');
await page.waitForFunction(() => document.querySelectorAll('.ai-result').length >= 1);
await page.waitForTimeout(800);
check('refining after you agreed does not ask again', (await page.locator('.ai-confirm').count()) === 0 && claudeCalls.length === 2);
await page.screenshot({ path: join(OUT, 'inline-cloud.png') });
await ctx.close();

/* ---------- 9. the Chat screen: a separate interface for AI chats (Ollama mocked) ---------- */
({ ctx, page } = await newPage());
const chatCalls = [];
let chatSlow = 0;
await page.route('http://localhost:11434/api/chat', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(req.postData());
  chatCalls.push(body);
  const user = body.messages.at(-1).content;
  if (chatSlow) await new Promise((r) => setTimeout(r, chatSlow));
  const text = /zebra/i.test(user) ? 'Zebras are striped.' : /<page>/.test(user) ? '# Summary\n\nA welcome page about the canvas.' : /again/.test(user) ? 'A second try.' : 'Hello from chat.';
  const lines = [...text.match(/.{1,10}/gs)].map((t) => JSON.stringify({ message: { content: t }, done: false }));
  lines.push(JSON.stringify({ message: { content: '' }, done: true }));
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/x-ndjson' }, body: lines.join('\n') + '\n' }).catch(() => {});
});
await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('text=Open an example page');
await page.waitForSelector('.block');
await page.click('.ed-back');
await page.waitForSelector('.sidebar');
// with the add-on off: a plain search box, Ctrl+K opens the switcher, and there is no Chat
check('with the add-on off the sidebar says "Search" with its shortcut, and has no Chat entry', (await page.locator('.side-search').innerText()).includes('Search') && !/ask/i.test(await page.locator('.side-search').innerText()) && /Ctrl\+K/.test(await page.locator('.side-search').innerText()) && (await page.locator('.nav-item:has-text("Chat")').count()) === 0);
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette');
check('Ctrl+K opens the quick switcher; without AI there is no "ask" wording or row', (await page.locator('.palette input').getAttribute('placeholder')) === 'Find or open a page…');
await page.keyboard.type('zebra');
check('...and no Ask AI row', (await page.locator('.palette [role=option]:has-text("Ask AI"), .palette li:has-text("Ask AI")').count()) === 0);
await page.keyboard.press('Escape');
// turn it on
await settingsTab(page, 'Add-ons');
await toggleAddon(page, 'AI assistant');
await page.waitForSelector('[aria-label="Ollama model"]');
await page.fill('[aria-label="Ollama model"]', 'mock-model');
await page.keyboard.press('Escape');
check('with AI on the box says "Search or ask"', /Search or ask/.test(await page.locator('.side-search').innerText()));
const firstNav = await page.locator('.side-section .nav-item').first().innerText();
check('a Chat entry appears first in the sidebar', /Chat/.test(firstNav), firstNav);
await page.click('.side-section .nav-item:has-text("Chat")');
await page.waitForSelector('.chatview');
check('Chat is a full screen of its own, with an empty state and four starters', /What can I help with\?/.test(await page.locator('.chat-empty').innerText()) && (await page.locator('.chat-starters button').count()) === 4);
check('it shows the provider and model, and that it is on this computer', /Ollama · mock-model/.test(await page.locator('.chatview .main-title').innerText()) && (await page.locator('.chatview .ai-badge.dest-local').count()) === 1);
check('"New chat" is disabled before anything is said', await page.locator('.chatview button:has-text("New chat")').isDisabled());
check('the sidebar marks Chat as the current screen', (await page.locator('.nav-item[aria-current="true"]').innerText()).includes('Chat'));
await page.screenshot({ path: join(OUT, 'chat-empty.png') });

// ask from "Search or ask": the question is asked in Chat
await page.click('.side-section .nav-item:has-text("All pages")');
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette');
check('the switcher now says "Find a page, or ask AI…"', (await page.locator('.palette input').getAttribute('placeholder')) === 'Find a page, or ask AI…');
await page.keyboard.type('what do zebras look like');
await page.waitForSelector('.palette >> text=Ask AI: “what do zebras look like”');
const rowsText = await page.locator('.palette li, .palette [role=option]').allInnerTexts();
check('the Ask AI row is the last row, so Enter still opens a page match first', /Ask AI/.test(rowsText.at(-1) ?? ''), JSON.stringify(rowsText));
await page.screenshot({ path: join(OUT, 'chat-ask-row.png') });
await page.click('.palette >> text=Ask AI: “what do zebras look like”');
await page.waitForSelector('.chatview .chat-msg.assistant .chat-bubble:has-text("Zebras are striped.")', { timeout: 15000 }).then(() => check('choosing it opens Chat and the question is answered there', true), () => check('choosing it opens Chat and the question is answered there', false));
check('the question appears as your message', (await page.locator('.chat-msg.user .chat-bubble').first().innerText()) === 'what do zebras look like');
check('only your words were sent (no page), after the safety instructions', chatCalls.at(-1).messages.at(-1).content === 'what do zebras look like' && /never as instructions/.test(chatCalls.at(-1).messages[0].content));

// type a message; Save as a page
await page.fill('textarea[aria-label="Message"]', 'say hello');
await page.keyboard.press('Enter');
await page.waitForSelector('.chat-msg.assistant:has-text("Hello from chat.")', { timeout: 15000 });
check('a typed message is answered, with the earlier turn kept in the conversation', chatCalls.at(-1).messages.length === 4 && chatCalls.at(-1).messages[2].content === 'Zebras are striped.');
const pageCountBefore = await page.evaluate(async () => Object.values((await import('/src/store/notes/index.ts')).useNotes.getState().pages).filter((p) => (p.kind ?? 'page') === 'page').length);
await page.click('.chat-msg.assistant >> nth=1 >> button:has-text("Save as a page")');
await page.waitForSelector('text=Saved as a new page');
const pagesAfter = await page.evaluate(async () => Object.values((await import('/src/store/notes/index.ts')).useNotes.getState().pages).filter((p) => (p.kind ?? 'page') === 'page').map((p) => ({ title: p.title, html: p.blocks[0]?.html })));
check('"Save as a page" makes a new page named after the answer, holding it as text', pagesAfter.length === pageCountBefore + 1 && pagesAfter.some((p) => p.title === 'Hello from chat.' && /Hello from chat\./.test(p.html ?? '')), JSON.stringify(pagesAfter.map((p) => p.title)));

// add pages to a question
await page.click('button:has-text("Add pages")');
await page.waitForSelector('.chat-picker');
check('"Add pages" lists your pages to choose from', (await page.locator('.chat-picker-row').count()) >= 2);
await page.fill('input[aria-label="Find a page to add"]', 'canvas');
await page.click('.chat-picker-row:has-text("Canvas basics")');
await page.click('.chat-picker button:has-text("Done")');
check('the chosen page shows as a chip, with how much text it adds', (await page.locator('.chat-chips .chip:has-text("Canvas basics")').count()) === 1 && /\d[\d,]* characters/.test(await page.locator('.chat-chars').innerText()));
await page.fill('textarea[aria-label="Message"]', 'Summarize this page');
await page.keyboard.press('Enter');
await page.waitForSelector('.chat-msg.assistant:has-text("A welcome page about the canvas.")', { timeout: 15000 });
const sentWithPage = chatCalls.at(-1).messages.at(-1).content;
check('the page went along inside <page> tags, with the question after it (local model, so no question asked)', /^<page>\nTitle: Canvas basics/.test(sentWithPage) && /<\/page>\n\nSummarize this page$/.test(sentWithPage) && (await page.locator('.ai-confirm').count()) === 0);
check('the message says which page was shared, and the chip row is cleared', /Shared the page: Canvas basics/.test(await page.locator('.chat-msg.user .ai-shared').last().innerText()) && (await page.locator('.chat-chips').count()) === 0);
check('a Markdown answer is shown formatted (a real heading, not "# Summary")', (await page.locator('.chat-msg.assistant .chat-bubble.md h1:has-text("Summary")').count()) === 1 && !/# Summary/.test(await page.locator('.chat-msg.assistant .chat-bubble.md').last().innerText()));
await page.screenshot({ path: join(OUT, 'chat-conversation.png') });

// try again, keep going, new chat
const callsBefore = chatCalls.length;
await page.click('.chat-msg.assistant >> nth=-1 >> button:has-text("Try again")');
await page.waitForTimeout(900);
check('"Try again" asks the last question again and replaces the answer', chatCalls.length === callsBefore + 1 && (await page.locator('.chat-msg.assistant').count()) === 3);

// it is kept while you move around, and is separate from a page's drawer
await page.click('.side-section .nav-item:has-text("All pages")');
check('another screen shows pages', (await page.locator('.chatview').count()) === 0);
await page.click('.side-section .nav-item:has-text("Chat")');
check('coming back to Chat finds the same conversation', (await page.locator('.chat-msg').count()) === 6);
await page.click('.side-section .nav-item:has-text("All pages")');
await page.click('.library .main >> text=Canvas basics');
await page.waitForSelector('.block');
await page.click('button:has-text("Assistant")');
await page.waitForSelector('.ai-panel');
check('a page’s Assistant drawer is a separate conversation (empty), not this one', (await page.locator('.ai-panel .ai-msg').count()) === 0 && (await page.locator('.ai-panel .ai-empty').count()) === 1);
await page.click('button[aria-label="Close assistant"]');
await page.click('.ed-back');
await page.waitForSelector('.sidebar');
await page.click('.side-section .nav-item:has-text("Chat")');
await page.waitForSelector('.chatview');
check('after visiting a page, Chat still has the conversation', (await page.locator('.chat-msg').count()) === 6);
await page.click('.chatview button:has-text("New chat")');
check('"New chat" forgets the conversation', (await page.locator('.chat-msg').count()) === 0 && (await page.locator('.chat-empty').count()) === 1);

// Escape stops an answer
chatSlow = 2500;
await page.fill('textarea[aria-label="Message"]', 'something slow');
await page.keyboard.press('Enter');
await page.waitForSelector('.chatview button:has-text("Stop")');
await page.keyboard.press('Escape');
await page.waitForSelector('.chatview button:has-text("Send")', { timeout: 5000 }).then(() => check('Escape (or Stop) ends an answer being written', true), () => check('Escape (or Stop) ends an answer being written', false));
await page.waitForTimeout(2800);
chatSlow = 0;
await page.click('.chatview button:has-text("New chat")');

// the command palette
await page.keyboard.press('Control+p');
await page.keyboard.type('AI chat');
await page.waitForSelector('.palette >> text=Open AI chat');
check('the command palette has "Open AI chat"', true);
await page.keyboard.press('Escape');

// cloud: pages are shown first
await settingsTab(page, 'Add-ons');
await page.selectOption('[aria-label="AI provider"]', 'anthropic');
await page.fill('input[aria-label="Claude (Anthropic) API key"]', 'sk-ant-TEST-chat');
await page.click('button:has-text("Save key")');
const claudeChat = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  claudeChat.push(JSON.parse(req.postData()));
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Claude here."}}\n\n', 'event: message_stop\ndata: {"type":"message_stop"}\n\n') });
});
await page.keyboard.press('Escape');
check('the Chat screen is labelled Cloud when Claude is chosen', (await page.locator('.chatview .ai-badge.dest-cloud').count()) === 1);
await page.click('button:has-text("Add pages")');
await page.click('.chat-picker-row >> nth=0');
await page.click('.chat-picker button:has-text("Done")');
await page.fill('textarea[aria-label="Message"]', 'What is on this page?');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-confirm');
check('before a cloud model sees a page, the exact message with the page is shown', /<page>/.test(await page.locator('.ai-preview[aria-label="The message"]').innerText()) && claudeChat.length === 0);
await page.click('button:has-text("Don’t send")');
await page.waitForTimeout(300);
check('"Don’t send" sends nothing and starts no conversation', claudeChat.length === 0 && (await page.locator('.chat-msg').count()) === 0);
await page.keyboard.press('Enter').catch(() => {});
await page.click('.chatview textarea[aria-label="Message"]');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-confirm');
await page.click('.ai-confirm button.primary');
await page.waitForSelector('.chat-msg.assistant:has-text("Claude here.")', { timeout: 15000 }).then(() => check('after "Send" Claude answers in the Chat screen', true), () => check('after "Send" Claude answers in the Chat screen', false));
await page.fill('textarea[aria-label="Message"]', 'thanks');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('.chat-msg.assistant').length === 2, null, { timeout: 15000 });
check('a follow-up with no page attached does not ask again', (await page.locator('.ai-confirm').count()) === 0 && claudeChat.length === 2);
await page.screenshot({ path: join(OUT, 'chat-cloud.png') });

// switching the add-on off while Chat is open goes back to All pages
await settingsTab(page, 'Add-ons');
await toggleAddon(page, 'AI assistant');
await page.keyboard.press('Escape');
await page.waitForSelector('.chatview', { state: 'detached', timeout: 5000 }).then(() => check('switching the add-on off while Chat is open goes back to All pages', true), () => check('switching the add-on off while Chat is open goes back to All pages', false));
check('...and the Chat entry and "ask" wording are gone', (await page.locator('.nav-item:has-text("Chat")').count()) === 0 && !/ask/i.test(await page.locator('.side-search').innerText()));
await ctx.close();

/* ---------- 10. Chat: the newest text is never hidden under the message box, even while it is being written ---------- */
({ ctx, page } = await newPage());
await page.setViewportSize({ width: 1300, height: 720 });
await page.route('http://localhost:11434/api/chat', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const user = JSON.parse(req.postData()).messages.at(-1).content;
  const text = /long/i.test(user) ? '# A long answer\n\n' + Array.from({ length: 36 }, (_, i) => `- Point number ${i + 1} about the topic, explained in a sentence.`).join('\n') + '\n\nTHE END OF THE ANSWER.' : 'Short.';
  const lines = [...text.match(/.{1,40}/gs)].map((t) => JSON.stringify({ message: { content: t }, done: false }));
  lines.push(JSON.stringify({ message: { content: '' }, done: true }));
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/x-ndjson' }, body: lines.join('\n') + '\n' });
});
await page.goto(URL);
await page.waitForSelector('.sidebar');
await settingsTab(page, 'Add-ons');
await toggleAddon(page, 'AI assistant');
await page.waitForSelector('[aria-label="Ollama model"]');
await page.fill('[aria-label="Ollama model"]', 'mock-model');
await page.keyboard.press('Escape');
await page.click('.side-section .nav-item:has-text("Chat")');
await page.waitForSelector('.chatview');
const hiddenBy = async () => {
  // how many pixels of the newest answer are covered by the message box (0 = none)
  return page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.chat-msg.assistant .chat-bubble')];
    const last = bubbles.at(-1);
    const box = document.querySelector('.chat-composer .chat-inputrow');
    if (!last || !box) return -1;
    const b = last.getBoundingClientRect(), c = box.getBoundingClientRect();
    const visibleTop = Math.max(b.top, 0);
    return Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(c.top, visibleTop)) * (b.bottom > c.top ? 1 : 0);
  });
};
for (const q of ['a long one', 'another long one', 'short question', 'a third long one']) {
  const had = await page.locator('.chat-msg.assistant').count();
  await page.fill('textarea[aria-label="Message"]', q);
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.chat-msg.assistant').length === n && !document.querySelector('.ai-caret'), had + 1, { timeout: 15000 });
  await page.waitForTimeout(300);
  const covered = await hiddenBy();
  check(`after "${q}" the newest answer is not hidden under the message box`, covered === 0, `${covered}px covered`);
  const endVisible = await page.evaluate(() => { const els = [...document.querySelectorAll('.chat-msg.assistant .chat-bubble')]; const r = els.at(-1).getBoundingClientRect(); const c = document.querySelector('.chat-composer .chat-inputrow').getBoundingClientRect(); return r.bottom <= c.top + 1 && r.bottom > 0; });
  check(`...and its last line is on screen above the box`, endVisible);
}
await page.screenshot({ path: join(OUT, 'chat-scroll.png') });
// scrolled up on purpose: a new question still brings you to the answer
await page.evaluate(() => { document.querySelector('.main').scrollTop = 0; });
await page.fill('textarea[aria-label="Message"]', 'one more long');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('.chat-msg.assistant').length === 5 && !document.querySelector('.ai-caret'), null, { timeout: 15000 });
await page.waitForTimeout(300);
check('asking a new question while scrolled up brings the new answer into view', (await hiddenBy()) === 0 && (await page.evaluate(() => { const r = [...document.querySelectorAll('.chat-msg.assistant .chat-bubble')].at(-1).getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })));

// ----- a real server that streams slowly, like a model writing an answer -----
const slow = http.createServer((req, res) => {
  const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
  req.resume();
  res.writeHead(200, { ...h, 'content-type': 'application/x-ndjson' });
  let i = 0;
  const t = setInterval(() => {
    const piece = i === 0 ? '# Writing slowly\n\n' : `- Line ${i} of the slowly written answer, with a few more words in it.\n`;
    res.write(JSON.stringify({ message: { content: piece }, done: false }) + '\n');
    if (++i > 45) { clearInterval(t); res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n'); }
  }, 90);
  res.on('close', () => clearInterval(t));
});
await new Promise((r) => slow.listen(0, '127.0.0.1', r));
const slowPort = slow.address().port;
await page.click('.side-section .nav-item:has-text("All pages")');
await settingsTab(page, 'Add-ons');
await page.fill('[aria-label="Ollama address"]', `http://127.0.0.1:${slowPort}`);
await page.keyboard.press('Escape');
await page.click('.side-section .nav-item:has-text("Chat")');
await page.click('.chatview button:has-text("New chat")');

const sample = () => page.evaluate(() => {
  const last = [...document.querySelectorAll('.chat-msg.assistant .chat-bubble')].at(-1);
  const box = document.querySelector('.chat-composer .chat-inputrow');
  if (!last || !box) return null;
  const b = last.getBoundingClientRect(), c = box.getBoundingClientRect();
  return { covered: b.bottom > c.top ? Math.max(0, Math.min(b.bottom, innerHeight) - c.top) : 0, bottomGap: c.top - b.bottom, grown: Math.round(b.height) };
});
await page.fill('textarea[aria-label="Message"]', 'stream please');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-caret');
const samples = [];
while (await page.locator('.ai-caret').count()) {
  const x = await sample();
  if (x && x.grown > 250) samples.push(x); // once the answer is taller than a small part of the screen
  await page.waitForTimeout(110);
}
check('while an answer is being written, its newest line is never covered by the message box', samples.length > 8 && samples.every((x) => x.covered === 0), `${samples.length} samples, worst ${Math.max(...samples.map((x) => x.covered))}px covered`);
check('...and it stays just above the box (the view follows the writing)', samples.slice(-10).every((x) => x.bottomGap >= 0 && x.bottomGap < 200), JSON.stringify(samples.slice(-3)));

// reading further up while it writes: the view must not be pulled back down
await page.fill('textarea[aria-label="Message"]', 'stream again');
await page.keyboard.press('Enter');
await page.waitForSelector('.ai-caret');
await page.waitForTimeout(1300);
const scrollBefore = await page.evaluate(() => { const m = document.querySelector('.main'); m.scrollTop = Math.max(0, m.scrollTop - 600); return m.scrollTop; });
await page.waitForTimeout(250);
const stillWriting = await page.locator('.ai-caret').count();
await page.waitForTimeout(1200);
const scrollAfter = await page.evaluate(() => document.querySelector('.main').scrollTop);
check('scrolling up to read while it writes is not undone by new text', stillWriting === 1 && Math.abs(scrollAfter - scrollBefore) <= 4, `before ${scrollBefore}, after ${scrollAfter}, still writing ${stillWriting}`);
await page.waitForFunction(() => !document.querySelector('.ai-caret'), null, { timeout: 15000 });
slow.close();
await ctx.close();

// The one 401 is the deliberately mocked "bad key" answer; the browser always logs a failed request.
const real = errors.filter((e) => !/status of 401/.test(e));
check('no console errors or exceptions (apart from the mocked 401)', real.length === 0, real.slice(0, 5).join(' || '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
