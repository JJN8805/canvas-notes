import { beforeEach, describe, expect, it, vi } from 'vitest';

// The network is replaced: these tests are about what the add-ons do with answers, not about HTTP.
const sent: { spec: { url: string; body?: string; provider: string }; opts: { model?: string } }[] = [];
let script: (spec: { provider: string; url: string }, opts: { onLine?: (l: string) => void; signal?: AbortSignal }) => Promise<string>;
vi.mock('../src/lib/llm/transport', () => ({
  sendRequest: (spec: never, opts: never) => {
    sent.push({ spec, opts });
    return script(spec, opts);
  },
  keys: { has: async () => false, set: async () => {}, clear: async () => {} },
}));

import { askChat, clearChat, createChat, drawImage, mainChat, needsConfirmation, regenerateLast, useChat, wireHistory, type Message } from '../src/addons/ai/chat';
import { streamChat } from '../src/addons/ai/stream';
import { cleanSettings, DEFAULT_SETTINGS, type AiSettings } from '../src/addons/ai/config';
import { cleanOcr } from '../src/addons/ocr/config';
import { localOllamaBase, MAX_OCR_CHARS, ocrProblem, ocrRequest, parseOcrResponse } from '../src/addons/ocr/ocr';
import { cardPictureSources, parseEnabled, useAddons } from '../src/addons/store';
import { b64ToFile, defaultCardPrompt, generateImageB64, imageDataUrl } from '../src/addons/ai/picture';
import { ADDONS } from '../src/addons/registry';
import { LlmError } from '../src/lib/llm/types';
import type { ImageBlock } from '../src/types';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const settings = (over: Partial<AiSettings> = {}): AiSettings => ({ ...DEFAULT_SETTINGS, models: { ollama: 'llama3.2', anthropic: 'claude-sonnet-5-5', openai: 'gpt-4o-mini' }, ...over });
const ndjson = (...texts: string[]) => [...texts.map((t) => JSON.stringify({ message: { content: t }, done: false })), JSON.stringify({ message: { content: '' }, done: true })];

beforeEach(() => {
  sent.length = 0;
  clearChat();
  mainChat.clear();
  script = async (_s, { onLine }) => {
    ndjson('Hello', ' world').forEach((l) => onLine?.(l));
    return '';
  };
});

describe('the consent rule for sending a page away', () => {
  const base = { destination: 'cloud' as const, confirmShare: true, newMessageHasPage: false, historyHasPage: false, provider: 'anthropic', consented: null as string | null };
  it('never asks for Ollama on this computer', () => {
    expect(needsConfirmation({ ...base, destination: 'local', newMessageHasPage: true })).toBe(false);
  });
  it('asks when a page is attached for the cloud or another computer', () => {
    expect(needsConfirmation({ ...base, newMessageHasPage: true })).toBe(true);
    expect(needsConfirmation({ ...base, destination: 'network', newMessageHasPage: true })).toBe(true);
  });
  it('does not ask for a plain question with no page anywhere in the chat', () => {
    expect(needsConfirmation(base)).toBe(false);
  });
  it('asks again when the chat switched provider and earlier messages carry page text', () => {
    expect(needsConfirmation({ ...base, historyHasPage: true, consented: null })).toBe(true);
    expect(needsConfirmation({ ...base, historyHasPage: true, consented: 'openai' })).toBe(true);
    expect(needsConfirmation({ ...base, historyHasPage: true, consented: 'anthropic' })).toBe(false);
  });
  it('respects the setting that turns the question off', () => {
    expect(needsConfirmation({ ...base, confirmShare: false, newMessageHasPage: true })).toBe(false);
  });
});

describe('chatting', () => {
  it('shows the answer as it arrives and ends with it complete', async () => {
    const seen: string[] = [];
    const unsub = useChat.subscribe((s) => s.messages.at(-1)?.role === 'assistant' && seen.push(s.messages.at(-1)!.content));
    await askChat(settings(), 'Hi');
    unsub();
    const [user, reply] = useChat.getState().messages;
    expect(user).toMatchObject({ role: 'user', content: 'Hi' });
    expect(reply).toMatchObject({ role: 'assistant', content: 'Hello world', streaming: false });
    expect(reply.error).toBeUndefined();
    expect(seen).toContain('Hello');
    expect(useChat.getState().busy).toBe(false);
  });

  it('sends the page with the message and the earlier turns with the next one', async () => {
    await askChat(settings(), 'Summarize', { wire: '<page>\nMy note\n</page>\n\nSummarize', shared: { chars: 7, blocks: 1 }, consent: true });
    await askChat(settings(), 'Shorter please');
    const second = JSON.parse(sent[1].spec.body!).messages;
    expect(second.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(second[1].content).toContain('<page>\nMy note');
    expect(second[2].content).toBe('Hello world');
    expect(second[3].content).toBe('Shorter please');
    expect(useChat.getState().consented).toBe('ollama');
  });

  it('shows a provider error on the answer and leaves it out of the next request', async () => {
    script = async (_s, { onLine }) => {
      onLine?.('{"error":"model \'x\' not found"}');
      return '';
    };
    await askChat(settings(), 'Hi');
    expect(useChat.getState().messages[1]).toMatchObject({ streaming: false, error: "model 'x' not found" });
    script = async (_s, { onLine }) => (ndjson('ok').forEach((l) => onLine?.(l)), '');
    await askChat(settings(), 'Again');
    const roles = JSON.parse(sent[1].spec.body!).messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(['system', 'user', 'user']); // the failed answer is not sent back as if it were real
  });

  it('shows a connection failure, and a model that says nothing', async () => {
    script = async () => {
      throw new LlmError('Couldn’t reach localhost:11434. Is Ollama running?');
    };
    await askChat(settings(), 'Hi');
    expect(useChat.getState().messages[1].error).toMatch(/Is Ollama running/);
    clearChat();
    script = async () => '';
    await askChat(settings(), 'Hi');
    expect(useChat.getState().messages[1].error).toMatch(/nothing/);
  });

  it('explains a missing model before sending anything', async () => {
    await askChat(settings({ models: { ollama: '', anthropic: '', openai: '' } }), 'Hi');
    expect(sent).toHaveLength(0);
    expect(useChat.getState().messages[1].error).toMatch(/Choose an Ollama model/);
  });

  it('can be stopped, keeping what had arrived', async () => {
    script = (_s, { onLine, signal }) =>
      new Promise((resolve) => {
        onLine?.(ndjson('Part')[0]);
        signal!.addEventListener('abort', () => resolve(''));
      });
    const p = askChat(settings(), 'Hi');
    await Promise.resolve();
    const { stopChat } = await import('../src/addons/ai/chat');
    stopChat();
    await p;
    expect(useChat.getState().messages[1]).toMatchObject({ content: 'Part', streaming: false });
    expect(useChat.getState().messages[1].error).toBeUndefined();
    expect(useChat.getState().busy).toBe(false);
  });

  it('ignores a second question while one is being answered', async () => {
    let release!: () => void;
    script = (_s, { onLine }) => new Promise((r) => (release = () => (ndjson('a').forEach((l) => onLine?.(l)), r(''))));
    const first = askChat(settings(), 'one');
    await askChat(settings(), 'two');
    expect(useChat.getState().messages).toHaveLength(2);
    release();
    await first;
    expect(sent).toHaveLength(1);
  });

  it('forgets everything when cleared', async () => {
    await askChat(settings(), 'Hi', { consent: true });
    clearChat();
    expect(useChat.getState()).toMatchObject({ messages: [], busy: false, consented: null });
  });

  it('turns pictures and failed turns into what a provider can take', () => {
    const msgs: Message[] = [
      { id: '1', role: 'user', content: 'draw a cat' },
      { id: '2', role: 'assistant', content: 'draw a cat', imageB64: 'AAAA' },
      { id: '3', role: 'user', content: 'again', wire: '<page>x</page>\n\nagain' },
      { id: '4', role: 'assistant', content: '', error: 'boom' },
      { id: '5', role: 'assistant', content: 'partial', streaming: true },
    ];
    expect(wireHistory(msgs)).toEqual([
      { role: 'user', content: 'draw a cat' },
      { role: 'assistant', content: '[A picture was generated for: draw a cat]' },
      { role: 'user', content: '<page>x</page>\n\nagain' },
    ]);
  });

  it('draws a picture with OpenAI, and shows why it could not', async () => {
    script = async () => JSON.stringify({ data: [{ b64_json: PNG_B64 }] });
    await drawImage(settings({ provider: 'openai' }), 'a red fox');
    expect(sent[0].spec.url).toBe('https://api.openai.com/v1/images/generations');
    expect(useChat.getState().messages[1]).toMatchObject({ imageB64: PNG_B64, streaming: false });
    clearChat();
    script = async () => '{"error":{"message":"Your request was rejected by the safety system."}}';
    await drawImage(settings({ provider: 'openai' }), 'x');
    expect(useChat.getState().messages[1].error).toMatch(/safety/);
  });
});

describe('saved settings', () => {
  it('reads odd or missing values safely', () => {
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings('junk')).toEqual(DEFAULT_SETTINGS);
    const s = cleanSettings({ provider: 'evil', ollamaUrl: '   ', models: { ollama: 5, openai: ' gpt-x ' }, imageModel: '', confirmShare: 'no' });
    expect(s).toMatchObject({ provider: 'ollama', ollamaUrl: 'http://localhost:11434', imageModel: 'gpt-image-1', confirmShare: true });
    expect(s.models).toEqual({ ollama: '', anthropic: 'claude-sonnet-5-5', openai: 'gpt-x', gemini: 'gemini-2.5-flash' });
    // settings saved before Gemini existed still load, with Gemini's defaults and the old choices kept
    const old = cleanSettings({ provider: 'openai', models: { ollama: 'llama3.2', anthropic: 'claude-sonnet-5-5', openai: 'gpt-4o' }, imageSource: 'sdwebui' });
    expect(old).toMatchObject({ provider: 'openai', imageSource: 'sdwebui', geminiImageModel: 'gemini-2.5-flash-image' });
    expect(old.models).toMatchObject({ openai: 'gpt-4o', gemini: 'gemini-2.5-flash' });
    expect(cleanSettings({ provider: 'gemini', imageSource: 'gemini' })).toMatchObject({ provider: 'gemini', imageSource: 'gemini' });
    expect(cleanSettings({ provider: 'anthropic', confirmShare: false })).toMatchObject({ provider: 'anthropic', confirmShare: false });
    expect(cleanSettings({ ollamaUrl: 'x'.repeat(500) }).ollamaUrl).toHaveLength(200);
  });
  it('never has an API key among its fields', () => {
    expect(Object.keys(DEFAULT_SETTINGS).join(' ').toLowerCase()).not.toMatch(/key|secret|token/);
    expect(JSON.stringify(cleanSettings({ apiKey: 'sk-1', models: { openai: 'm' } }))).not.toContain('sk-1');
  });
});

describe('which add-ons are on', () => {
  it('keeps only add-ons that exist, once each', () => {
    expect(parseEnabled(null)).toEqual([]);
    expect(parseEnabled('not json')).toEqual([]);
    expect(parseEnabled('{"a":1}')).toEqual([]);
    expect(parseEnabled('["ai","ocr","ai","from-the-future",7]')).toEqual(['ai', 'ocr']);
  });
  it('lists each add-on with a plain privacy statement', () => {
    expect(ADDONS.map((a) => a.id)).toEqual(['ai', 'ocr']);
    for (const a of ADDONS) expect(a.privacy.length).toBeGreaterThan(20);
    expect(ADDONS.find((a) => a.id === 'ocr')!.privacy).toMatch(/only to Ollama on this computer/);
  });
});

describe('text from pictures', () => {
  const img = (over: Partial<ImageBlock> = {}): ImageBlock => ({ id: 'i', type: 'image', x: 0, y: 0, w: 1, h: 1, z: 1, imageId: 'f1', aspect: 1, ...over });

  it('only talks to Ollama on this computer', () => {
    expect(localOllamaBase('localhost:11434')).toBe('http://localhost:11434');
    expect(localOllamaBase('http://127.0.0.1:11434/')).toBe('http://127.0.0.1:11434');
    for (const bad of ['http://192.168.1.5:11434', 'https://api.openai.com', 'http://localhost.evil.com', 'ftp://localhost', '']) expect(() => localOllamaBase(bad), bad).toThrow(LlmError);
    expect(() => ocrRequest({ url: 'http://192.168.1.5:11434', model: 'llava' }, 'AAAA')).toThrow(/never leave it/);
  });

  it('asks for the text with the picture attached, not streamed', () => {
    const r = ocrRequest({ url: 'http://localhost:11434', model: 'llama3.2-vision' }, 'QUJD');
    expect(r).toMatchObject({ provider: 'ollama', method: 'POST', url: 'http://localhost:11434/api/chat', stream: false });
    const body = JSON.parse(r.body!);
    expect(body).toMatchObject({ model: 'llama3.2-vision', stream: false });
    expect(body.messages[0].images).toEqual(['QUJD']);
    expect(() => ocrRequest({ url: 'http://localhost:11434', model: ' ' }, 'x')).toThrow(/Choose a vision model/);
  });

  it('reads the answer: plain text, fenced text, "NO TEXT", long text and errors', () => {
    expect(parseOcrResponse('{"message":{"content":"  TOTAL 42.50\\r\\nThank you  "}}')).toBe('TOTAL 42.50\nThank you');
    expect(parseOcrResponse('{"message":{"content":"```\\nline one\\nline two\\n```"}}')).toBe('line one\nline two');
    expect(parseOcrResponse('{"message":{"content":"NO TEXT"}}')).toBe('');
    expect(parseOcrResponse('{"message":{"content":"no text."}}')).toBe('');
    expect(parseOcrResponse('{"message":{"content":""}}')).toBe('');
    expect(parseOcrResponse(JSON.stringify({ message: { content: 'x'.repeat(MAX_OCR_CHARS + 50) } }))).toHaveLength(MAX_OCR_CHARS);
    expect(() => parseOcrResponse('{"error":"model requires more system memory"}')).toThrow(/more system memory/);
    expect(() => parseOcrResponse('<html>')).toThrow(/wasn’t understood/);
  });

  it('skips pictures it cannot read, saying why', () => {
    expect(ocrProblem(img(), 'image/png', 1000)).toBeNull();
    expect(ocrProblem(img(), 'image/jpeg', 1000)).toBeNull();
    expect(ocrProblem(img({ heat: 'abc' }), 'image/png', 1000)).toMatch(/drawn by the app/);
    expect(ocrProblem(img({ imageId: '' }), undefined, 0)).toMatch(/no image yet/);
    expect(ocrProblem(img(), undefined, 0)).toMatch(/missing/);
    expect(ocrProblem(img(), 'image/svg+xml', 1000)).toMatch(/SVG/);
    expect(ocrProblem(img(), 'application/pdf', 1000)).toMatch(/can’t be read/);
    expect(ocrProblem(img(), 'image/png', 13 * 1024 * 1024)).toMatch(/too large/);
  });

  it('has settings that fall back safely', () => {
    expect(cleanOcr(null)).toEqual({ url: 'http://localhost:11434', model: '' });
    expect(cleanOcr({ url: ' ', model: ' llava ' })).toEqual({ url: 'http://localhost:11434', model: 'llava' });
  });
});

describe('pictures for cards', () => {
  it('starts the description from the card label, and from nothing when it has none', () => {
    expect(defaultCardPrompt('Garden')).toBe('A picture for a card titled “Garden”');
    expect(defaultCardPrompt('  Tokyo trip  ')).toBe('A picture for a card titled “Tokyo trip”');
    expect(defaultCardPrompt('   ')).toBe('');
    expect(defaultCardPrompt('x'.repeat(200))).toHaveLength('A picture for a card titled “”'.length + 80);
  });

  it('sends only the typed description to OpenAI and returns the picture', async () => {
    script = async () => JSON.stringify({ data: [{ b64_json: PNG_B64 }] });
    expect(await generateImageB64(settings({ provider: 'ollama' }), '  a tomato garden  ')).toBe(PNG_B64);
    expect(sent).toHaveLength(1);
    expect(sent[0].spec).toMatchObject({ provider: 'openai', url: 'https://api.openai.com/v1/images/generations' });
    const body = JSON.parse(sent[0].spec.body!);
    expect(body.prompt).toBe('a tomato garden'); // trimmed, and nothing from the card added
    expect(Object.keys(body).sort()).toEqual(['model', 'n', 'prompt', 'size']);
  });

  it('works whichever provider chat uses, because pictures always come from OpenAI', async () => {
    script = async () => JSON.stringify({ data: [{ b64_json: PNG_B64 }] });
    for (const provider of ['ollama', 'anthropic', 'openai'] as const) await generateImageB64(settings({ provider }), 'x');
    expect(sent.every((c) => c.spec.provider === 'openai')).toBe(true);
  });

  it('says why when no picture comes back, and when it was stopped', async () => {
    script = async () => '{"error":{"message":"Billing hard limit has been reached"}}';
    await expect(generateImageB64(settings(), 'x')).rejects.toThrow(/Billing hard limit/);
    script = async () => '{"data":[{"url":"https://x/y.png"}]}';
    await expect(generateImageB64(settings(), 'x')).rejects.toThrow(/web link/);
    const stopped = new AbortController();
    script = async () => (stopped.abort(), JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
    await expect(generateImageB64(settings(), 'x', stopped.signal)).rejects.toThrow('Stopped.');
  });

  it('turns the base64 picture into a PNG file the card can take', async () => {
    const f = b64ToFile(Buffer.from([137, 80, 78, 71]).toString('base64'), 'AI picture.png');
    expect(f).toMatchObject({ name: 'AI picture.png', type: 'image/png', size: 4 });
    expect([...new Uint8Array(await f.arrayBuffer())]).toEqual([137, 80, 78, 71]);
  });

  it('is offered on a card only while the AI add-on is running', () => {
    useAddons.setState({ loaded: {} });
    expect(cardPictureSources()).toEqual([]);
    const Dialog = () => null;
    useAddons.setState({ loaded: { ai: { Settings: () => null, cardPictureSources: [{ label: 'Generate with AI', Dialog }] } } });
    expect(cardPictureSources().map((s) => [s.key, s.label])).toEqual([['ai:0', 'Generate with AI']]);
    useAddons.setState({ loaded: { ocr: { Settings: () => null } } }); // the OCR add-on adds no picture source
    expect(cardPictureSources()).toEqual([]);
    useAddons.setState({ loaded: {} });
  });
});

describe('picture sources in the add-on', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('keeps drawing with OpenAI for settings saved before picture sources existed', () => {
    const old = { provider: 'anthropic', ollamaUrl: 'http://localhost:11434', models: { openai: 'm' }, imageModel: 'dall-e-3', confirmShare: false };
    const s = cleanSettings(old);
    expect(s).toMatchObject({ imageSource: 'openai', imageModel: 'dall-e-3', imageSize: 512, imageSteps: 20, imageServerModel: '' });
    expect(s.imageUrls).toEqual({ sdwebui: 'http://127.0.0.1:7860', imageserver: 'http://localhost:8080' });
  });

  it('reads odd picture settings safely', () => {
    const s = cleanSettings({ imageSource: 'evil', imageSize: 999, imageSteps: 'many', imageUrls: { sdwebui: '   ', imageserver: 5 }, imageServerModel: 7 });
    expect(s).toMatchObject({ imageSource: 'openai', imageSize: 512, imageSteps: 20, imageServerModel: '' });
    expect(s.imageUrls.sdwebui).toBe('http://127.0.0.1:7860');
    expect(cleanSettings({ imageSource: 'sdwebui', imageSize: 1024, imageSteps: 1e9, imageUrls: { sdwebui: ' http://10.0.0.2:7860 ' } })).toMatchObject({ imageSource: 'sdwebui', imageSize: 1024, imageSteps: 150, imageUrls: { sdwebui: 'http://10.0.0.2:7860' } });
    expect(cleanSettings({ imageSteps: 0 }).imageSteps).toBe(1);
  });

  it('draws with a Stable Diffusion server and needs no key, whatever the chat uses', async () => {
    script = async () => JSON.stringify({ images: [PNG], parameters: {}, info: '' });
    for (const provider of ['ollama', 'anthropic', 'openai'] as const) {
      expect(await generateImageB64(settings({ provider, imageSource: 'sdwebui' }), '  a red fox ')).toBe(PNG);
    }
    expect(sent.every((c) => c.spec.provider === 'sdwebui' && c.spec.url === 'http://127.0.0.1:7860/sdapi/v1/txt2img')).toBe(true);
    expect(JSON.parse(sent[0].spec.body!).prompt).toBe('a red fox');
    expect(sent.some((c) => /openai|anthropic/.test(c.spec.url))).toBe(false); // nothing went to a company
  });

  it('draws with an OpenAI-compatible server and passes the model name for error messages', async () => {
    script = async () => JSON.stringify({ data: [{ b64_json: PNG }] });
    await generateImageB64(settings({ imageSource: 'imageserver', imageServerModel: 'flux-schnell' }), 'x');
    expect(sent[0].spec.url).toBe('http://localhost:8080/v1/images/generations');
    expect(sent[0].opts.model).toBe('flux-schnell');
  });

  it('shows what a server complains about', async () => {
    script = async () => JSON.stringify({ detail: 'No checkpoint loaded' });
    await expect(generateImageB64(settings({ imageSource: 'sdwebui' }), 'x')).rejects.toThrow('No checkpoint loaded');
  });

  it('turns a JPEG answer into a .jpg file and a matching preview', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1]).toString('base64');
    const f = b64ToFile(jpeg, 'AI picture.png');
    expect(f).toMatchObject({ name: 'AI picture.jpg', type: 'image/jpeg' });
    expect(imageDataUrl(jpeg)).toMatch(/^data:image\/jpeg;base64,/);
    expect(b64ToFile(PNG, 'AI picture')).toMatchObject({ name: 'AI picture.png', type: 'image/png' });
  });
});

describe('one streamed answer', () => {
  const ollama = (...texts: string[]) => async (_s: unknown, { onLine }: { onLine?: (l: string) => void }) => (ndjson(...texts).forEach((l) => onLine?.(l)), '');

  it('returns the whole answer and tells the caller the answer so far after each piece', async () => {
    script = ollama('Hel', 'lo ', 'there');
    const seen: string[] = [];
    expect(await streamChat(settings(), 'SYS', [{ role: 'user', content: 'hi' }], { onText: (t) => seen.push(t) })).toBe('Hello there');
    expect(seen).toEqual(['Hel', 'Hello ', 'Hello there']);
    expect(JSON.parse(sent[0].spec.body!).messages[0]).toEqual({ role: 'system', content: 'SYS' });
  });

  it('throws the provider’s message, after the text that had already arrived', async () => {
    script = async (_s, { onLine }) => {
      onLine?.(ndjson('Part')[0]);
      onLine?.('{"error":"the model ran out of memory"}');
      return '';
    };
    const seen: string[] = [];
    await expect(streamChat(settings(), 's', [{ role: 'user', content: 'hi' }], { onText: (t) => seen.push(t) })).rejects.toThrow('the model ran out of memory');
    expect(seen).toEqual(['Part']);
  });

  it('throws when the model says nothing, but returns quietly when stopped', async () => {
    script = async () => '';
    await expect(streamChat(settings(), 's', [])).rejects.toThrow(/nothing/);
    const stopped = new AbortController();
    script = async () => (stopped.abort(), '');
    expect(await streamChat(settings(), 's', [], { signal: stopped.signal })).toBe('');
  });
});

describe('trying the last question again', () => {
  it('asks it afresh and replaces the last answer, keeping the page that was attached', async () => {
    script = async (_s, { onLine }) => (ndjson('first answer').forEach((l) => onLine?.(l)), '');
    await askChat(settings(), 'Summarize', { wire: '<page>\nMy note\n</page>\n\nSummarize', shared: { chars: 7, blocks: 1 }, consent: true });
    script = async (_s, { onLine }) => (ndjson('second answer').forEach((l) => onLine?.(l)), '');
    await regenerateLast(settings());
    const msgs = useChat.getState().messages;
    expect(msgs.map((m) => [m.role, m.content])).toEqual([['user', 'Summarize'], ['assistant', 'second answer']]);
    expect(msgs[0].shared).toEqual({ chars: 7, blocks: 1 });
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[1].spec.body!).messages[1].content).toContain('<page>\nMy note'); // the page went along again
  });

  it('retries after an error, and does nothing with no question or while answering', async () => {
    await regenerateLast(settings()); // nothing asked yet
    expect(sent).toHaveLength(0);
    script = async () => {
      throw new LlmError('Couldn’t reach Ollama.');
    };
    await askChat(settings(), 'Hi');
    expect(useChat.getState().messages[1].error).toBeTruthy();
    script = async (_s, { onLine }) => (ndjson('ok now').forEach((l) => onLine?.(l)), '');
    await regenerateLast(settings());
    expect(useChat.getState().messages.map((m) => [m.role, m.content, m.error ?? null])).toEqual([['user', 'Hi', null], ['assistant', 'ok now', null]]);
  });
});

describe('the Chat screen has a conversation of its own', () => {
  beforeEach(() => {
    script = async (_s, { onLine }) => (ndjson('an answer').forEach((l) => onLine?.(l)), '');
  });

  it('is separate from the page drawer’s: neither sees, keeps or forgets the other’s messages', async () => {
    await mainChat.ask(settings(), 'in the Chat screen', { consent: true });
    expect(mainChat.useStore.getState().messages.map((m) => m.content)).toEqual(['in the Chat screen', 'an answer']);
    expect(useChat.getState().messages).toEqual([]);
    await askChat(settings(), 'in the drawer');
    expect(useChat.getState().messages.map((m) => m.content)).toEqual(['in the drawer', 'an answer']);
    // each only sent its own conversation
    expect(JSON.parse(sent[1].spec.body!).messages.map((m: { content: string }) => m.content)).toEqual([expect.any(String), 'in the drawer']);
    clearChat(); // the drawer closing forgets only the drawer's chat
    expect(useChat.getState().messages).toEqual([]);
    expect(mainChat.useStore.getState().messages).toHaveLength(2);
    expect(mainChat.useStore.getState().consented).toBe('ollama');
    mainChat.clear();
    expect(mainChat.useStore.getState()).toMatchObject({ messages: [], busy: false, consented: null });
  });

  it('can answer in both at once, and stopping one leaves the other running', async () => {
    let release!: () => void;
    script = (_s, { onLine, signal }) =>
      new Promise((resolve) => {
        onLine?.(ndjson('part')[0]);
        release = () => (ndjson('done')[1] && resolve(''), undefined);
        signal!.addEventListener('abort', () => resolve(''));
      });
    const a = mainChat.ask(settings(), 'one');
    const other = createChat();
    const b = other.ask(settings(), 'two');
    expect(mainChat.useStore.getState().busy).toBe(true);
    expect(other.useStore.getState().busy).toBe(true);
    mainChat.stop();
    await a;
    expect(mainChat.useStore.getState().busy).toBe(false);
    expect(other.useStore.getState().busy).toBe(true); // the other conversation was not touched
    other.stop();
    await b;
    release?.();
  });

  it('keeps which pages were shared with each message, and asks them again on Try again', async () => {
    await mainChat.ask(settings(), 'Summarize', { wire: '<page>\nx\n</page>\n\nSummarize', shared: { chars: 1, blocks: 1 }, sharedPages: ['Trip plan'] });
    await mainChat.regenerate(settings());
    const [user] = mainChat.useStore.getState().messages;
    expect(user.sharedPages).toEqual(['Trip plan']);
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[1].spec.body!).messages[1].content).toContain('<page>');
  });
});
