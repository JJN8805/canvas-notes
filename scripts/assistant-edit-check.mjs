// The assistant changing the page, with the user approving: a mocked local model, the real app in headless Chromium.
// Run with the dev server up (`npm run dev`):  node scripts/assistant-edit-check.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:1420';
const OUT = join(tmpdir(), 'canvas-assistant-edit-check');
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
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
};
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' ? errors.push(m.text().slice(0, 200)) : 0));
page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));

const calls = [];
// A deterministic "model": it reads the labelled page it is given and proposes changes by label.
const answer = (system, user) => {
  const label = (user.match(/\[(b\d+): text box\]\nteh quick/) ?? [])[1];
  if (/Fix the spelling/.test(user) && label)
    return `I fixed the spelling in your text box.\n\`\`\`edits\n[{"op":"text","box":"${label}","markdown":"The quick brown fox"}]\n\`\`\``;
  if (/Add a to-do list/.test(user)) return 'Added a list.\n```edits\n[{"op":"add","what":"checklist","items":["Buy milk",{"text":"Call Sam","done":false}]}]\n```';
  if (/Fix the ghost/.test(user)) return 'Done.\n```edits\n[{"op":"text","box":"b99","markdown":"x"}]\n```';
  if (/What is on this page/.test(user)) return 'A note about a fox.';
  return 'Hello.';
};
await page.route('http://localhost:11434/api/chat', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(req.postData());
  calls.push(body);
  const text = answer(body.messages[0].content, body.messages.at(-1).content);
  const lines = [...text.match(/.{1,14}/gs)].map((t) => JSON.stringify({ message: { content: t }, done: false }));
  lines.push(JSON.stringify({ message: { content: '' }, done: true }));
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/x-ndjson' }, body: lines.join('\n') + '\n' });
});
await page.route('http://localhost:11434/api/tags', (route) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'mock:1b' }] }) }));

await page.goto(URL);
await page.waitForSelector('.sidebar');
await page.click('button[aria-label="Settings"], .sidebar >> text=Settings');
await page.click('[role=tab]:has-text("Add-ons")');
await page.click('button[role=switch]:has-text("Turn on AI assistant")');
await page.waitForSelector('[aria-label="Ollama model"]');
await page.fill('[aria-label="Ollama model"]', 'mock:1b');
await page.keyboard.press('Escape');
await page.click('text=Open an example page');
await page.waitForSelector('.block');

// a text box of my own, with typos
await page.dblclick('.ed-body', { position: { x: 700, y: 660 } });
await page.waitForSelector('.ProseMirror-focused');
await page.keyboard.type('teh quick brown fox');
const id = await page.locator('.block:has(.ProseMirror-focused)').getAttribute('data-id');
await page.keyboard.press('Escape');
const mine = page.locator(`.block[data-id="${id}"] .ProseMirror`).first();
const mineText = async () => (await mine.innerText()).trim();
await page.waitForTimeout(500);

await page.click('button:has-text("Assistant")');
await page.waitForSelector('.ai-panel');
const toggle = page.locator('.ai-panel label:has-text("suggest changes") input');
check('the assistant offers to suggest changes, on by default', (await toggle.count()) === 1 && (await toggle.isChecked()));

const ask = async (t) => {
  await page.fill('textarea[aria-label="Message to the assistant"]', t);
  await page.keyboard.press('Enter');
};

// 1. a request to change an existing box
await ask('Fix the spelling in my text box');
await page.waitForSelector('.ai-proposal');
const sent = calls.at(-1).messages;
check('the model was told how to propose changes, and that nothing is changed until the user decides', /NOT made when you answer/.test(sent[0].content));
check('the model was shown the page box by box with labels, not real ids', /\[b\d+: text box\]\nteh quick brown fox/.test(sent.at(-1).content) && !sent.at(-1).content.includes(id));
check('the edits block is not shown as part of the answer', !/```|"op"/.test(await page.locator('.ai-msg.assistant .ai-text').last().innerText()));
check('the box on the page is NOT changed yet', (await mineText()) === 'teh quick brown fox', await mineText());
const prop = await page.locator('.ai-proposal').innerText();
check('the proposal shows what the box is now and what it would become', /Now\s+teh quick brown fox/i.test(prop) && /Becomes\s+The quick brown fox/i.test(prop) && /not applied yet/i.test(prop), prop);
await page.screenshot({ path: join(OUT, 'proposal.png') });

// 2. discard leaves everything alone
await page.click('.ai-proposal button:has-text("Discard")');
check('Discard leaves the box as it was and says so', (await mineText()) === 'teh quick brown fox' && /not applied/i.test(await page.locator('.ai-proposal').innerText()));

// 3. ask again, then apply
await ask('Fix the spelling in my text box please');
await page.waitForFunction(() => document.querySelectorAll('.ai-proposal button:not([disabled])').length > 0 && [...document.querySelectorAll('.ai-proposal')].length === 2);
await page.locator('.ai-proposal').last().locator('button:has-text("Apply")').click();
await page.waitForFunction((s) => document.querySelector(s)?.textContent?.trim() === 'The quick brown fox', `.block[data-id="${id}"] .ProseMirror`);
check('Apply changed the box on the page', (await mineText()) === 'The quick brown fox');
const done = await page.locator('.ai-proposal').last().innerText();
check('it says the change was applied and offers Undo', /applied/i.test(done) && (await page.locator('.ai-proposal').last().locator('button:has-text("Undo")').count()) === 1, done);
await page.screenshot({ path: join(OUT, 'applied.png') });
await page.locator('.ai-proposal').last().locator('button:has-text("Undo")').click();
await page.waitForFunction((s) => document.querySelector(s)?.textContent?.trim() === 'teh quick brown fox', `.block[data-id="${id}"] .ProseMirror`);
check('Undo put the box back as it was', (await mineText()) === 'teh quick brown fox');

// 4. Ctrl+Z also works after applying (one undo step)
await ask('Fix the spelling in my text box once more');
await page.waitForFunction(() => document.querySelectorAll('.ai-proposal').length === 3);
await page.locator('.ai-proposal').last().locator('button:has-text("Apply")').click();
await page.waitForFunction((s) => document.querySelector(s)?.textContent?.trim() === 'The quick brown fox', `.block[data-id="${id}"] .ProseMirror`);
await page.click('.ed-head button[aria-label="Undo"], .ed-head button[title^="Undo"]').catch(() => {});
await page.waitForFunction((s) => document.querySelector(s)?.textContent?.trim() === 'teh quick brown fox', `.block[data-id="${id}"] .ProseMirror`, { timeout: 4000 }).then(
  () => check("the editor's own Undo also reverses it", true),
  async () => check("the editor's own Undo also reverses it", false, await mineText()),
);

// 5. typing in the box while a proposal is open: it is no longer applied over the new text
await ask('Fix the spelling in my text box again');
await page.waitForFunction(() => document.querySelectorAll('.ai-proposal').length === 4);
await mine.click();
await page.keyboard.press('End');
await page.keyboard.type(' and then some');
await page.waitForTimeout(400);
const last = page.locator('.ai-proposal').last();
check('a box edited after the page was sent is not offered for change', /changed after the page was sent/.test(await last.innerText()) && (await last.locator('button:has-text("Apply")').isDisabled()), await last.innerText());
check('and what the user typed is untouched', /and then some/.test(await mineText()));

// 6. adding a box
await ask('Add a to-do list');
await page.waitForFunction(() => document.querySelectorAll('.ai-proposal').length === 5);
const before = await page.locator('.block').count();
check('the proposal to add a list says so', /Add a checklist/.test(await page.locator('.ai-proposal').last().innerText()));
check('nothing was added before approval', (await page.locator('.block').count()) === before);
await page.locator('.ai-proposal').last().locator('button:has-text("Apply")').click();
await page.waitForFunction((n) => document.querySelectorAll('.block').length === n + 1, before);
check('Apply added the checklist with its items', (await page.locator('.block:has-text("Buy milk")').count()) >= 1 && (await page.locator('.block:has-text("Call Sam")').count()) >= 1);

// 7. a made-up box label is refused, and nothing else is touched
await ask('Fix the ghost');
await page.waitForFunction(() => document.querySelectorAll('.ai-proposal').length === 6);
const ghost = page.locator('.ai-proposal').last();
check('a change to a box the assistant was never shown is refused', /not on the page it was shown/.test(await ghost.innerText()) && (await ghost.locator('button:has-text("Apply")').isDisabled()));

// 8. turning it off: the assistant still reads the page, but is not told it can change anything
await toggle.uncheck();
await ask('What is on this page?');
await page.waitForFunction(() => document.querySelector('.ai-msg.assistant:last-of-type')?.textContent?.includes('fox'));
const plain = calls.at(-1).messages;
check('with the option off the page is sent as plain text and no edit instructions are added', !/NOT made when you answer/.test(plain[0].content) && !/\[b\d+: /.test(plain.at(-1).content) && /teh quick brown fox/.test(plain.at(-1).content)); // (my text box is still selected, so only it is shared: the usual selection rule)
await page.screenshot({ path: join(OUT, 'off.png') });

check('no console errors or exceptions', errors.length === 0, errors.slice(0, 4).join(' || '));
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(bad ? 1 : 0);
