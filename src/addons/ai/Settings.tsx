import { useEffect, useState } from 'react';
import { IMAGE_SIZES, IMAGE_SOURCES, PROVIDERS, chatRequest, imageModelsRequest, ollamaModelsRequest, parseImageModels, parseOllamaModels } from '../../lib/llm/providers';
import { imageDestination } from '../../lib/llm/image';
import { keys, sendRequest } from '../../lib/llm/transport';
import { destinationOf } from '../../lib/llm/url';
import { LlmError, type ImageSource, type ProviderId } from '../../lib/llm/types';
import { isTauri } from '../../storage';
import { loadAiSettings, saveAiSettings, useAiSettings } from './config';
import { SYSTEM_PROMPT } from './prompts';

const DEST_TEXT = {
  local: 'Ollama on this computer. Nothing leaves it.',
  network: 'Ollama on another computer. What you share goes to that computer over your network.',
  cloud: 'A company’s servers. What you share, which you see first, is sent over the internet.',
} as const;

function KeyRow({ provider }: { provider: Exclude<ProviderId, 'ollama'> }) {
  const [has, setHas] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void keys.has(provider).then(setHas, () => setHas(false));
  }, [provider]);
  const save = async () => {
    try {
      await keys.set(provider, draft);
      setDraft('');
      setHas(true);
      setMsg('Key saved.');
    } catch (e) {
      setMsg(e instanceof LlmError ? e.message : 'The key couldn’t be saved.');
    }
  };
  return (
    <div className="ai-key">
      <div className="set-row">
        <span>{PROVIDERS[provider].label} API key</span>
        <span className={'ai-status ' + (has ? 'ok' : '')}>{has === null ? '' : has ? 'Saved' : 'Not set'}</span>
      </div>
      <div className="row start">
        <input
          className="field"
          type="password"
          autoComplete="off"
          placeholder={has ? 'Paste a new key to replace it' : 'Paste your key'}
          aria-label={`${PROVIDERS[provider].label} API key`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && draft && void save()}
        />
        <button className="btn" disabled={!draft.trim()} onClick={() => void save()}>Save key</button>
        {has && (
          <button className="btn" onClick={() => void keys.clear(provider).then(() => { setHas(false); setMsg('Key removed.'); })}>
            Remove
          </button>
        )}
      </div>
      {msg && <p className="ai-note" role="status">{msg}</p>}
    </div>
  );
}

export function AiSettings() {
  const { settings: s, loaded } = useAiSettings();
  const [models, setModels] = useState<string[]>([]);
  const [check, setCheck] = useState('');
  const [checking, setChecking] = useState(false);
  const [imgModels, setImgModels] = useState<string[]>([]);
  const [imgMsg, setImgMsg] = useState('');
  useEffect(() => {
    if (!loaded) void loadAiSettings();
  }, [loaded]);
  const dest = destinationOf(s.provider, s.ollamaUrl);

  const listModels = async () => {
    setChecking(true);
    setCheck('');
    try {
      const found = parseOllamaModels(await sendRequest(ollamaModelsRequest(s)));
      setModels(found);
      setCheck(found.length ? `Found ${found.length} model${found.length === 1 ? '' : 's'}.` : 'Ollama is running but has no models yet. Pull one, e.g. “ollama pull llama3.2”.');
      if (found.length && !s.models.ollama) saveAiSettings({ models: { ...s.models, ollama: found[0] } });
    } catch (e) {
      setCheck(e instanceof Error ? e.message : 'Couldn’t reach Ollama.');
    } finally {
      setChecking(false);
    }
  };

  const checkPictureServer = async () => {
    setChecking(true);
    setImgMsg('');
    try {
      const found = parseImageModels(s.imageSource, await sendRequest(imageModelsRequest(s)));
      setImgModels(found);
      setImgMsg(found.length ? `Connected. The server lists ${found.length} model${found.length === 1 ? '' : 's'}.` : 'Connected, but it listed no models. You can still draw with whatever it has loaded.');
    } catch (e) {
      setImgMsg(e instanceof Error ? e.message : 'Couldn’t reach the picture server.');
    } finally {
      setChecking(false);
    }
  };

  const test = async () => {
    setChecking(true);
    setCheck('');
    try {
      let reply = '';
      const spec = chatRequest(s, SYSTEM_PROMPT, [{ role: 'user', content: 'Reply with the single word OK.' }]);
      const { parseStreamLine } = await import('../../lib/llm/providers');
      await sendRequest(spec, {
        model: s.models[s.provider],
        onLine: (l) => parseStreamLine(spec.provider, l).forEach((ev) => {
          if (ev.type === 'text') reply += ev.text;
          if (ev.type === 'error') throw new LlmError(ev.message);
        }),
      });
      setCheck(reply ? `It works. The model said: “${reply.trim().slice(0, 60)}”` : 'Connected, but the model sent back nothing.');
    } catch (e) {
      setCheck(e instanceof Error ? e.message : 'The test failed.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="ai-settings">
      <label className="set-row">
        <span>Use</span>
        <select className="field" aria-label="AI provider" value={s.provider} onChange={(e) => saveAiSettings({ provider: e.target.value as ProviderId })}>
          {(Object.values(PROVIDERS)).map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <p className={'ai-note dest-' + dest} role="note">{DEST_TEXT[dest]}</p>

      {s.provider === 'ollama' && (
        <>
          <label className="set-row">
            <span>Ollama address</span>
            <input className="field" aria-label="Ollama address" value={s.ollamaUrl} onChange={(e) => saveAiSettings({ ollamaUrl: e.target.value })} />
          </label>
          <label className="set-row">
            <span>Model</span>
            <input className="field" list="ai-ollama-models" aria-label="Ollama model" placeholder="e.g. llama3.2" value={s.models.ollama} onChange={(e) => saveAiSettings({ models: { ...s.models, ollama: e.target.value } })} />
            <datalist id="ai-ollama-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <div className="row start">
            <button className="btn" disabled={checking} onClick={() => void listModels()}>Find models</button>
            <button className="btn" disabled={checking || !s.models.ollama} onClick={() => void test()}>Test</button>
          </div>
        </>
      )}

      {s.provider !== 'ollama' && (
        <>
          <KeyRow provider={s.provider} />
          <label className="set-row">
            <span>Model</span>
            <input className="field" list="ai-cloud-models" aria-label="Model name" value={s.models[s.provider]} onChange={(e) => saveAiSettings({ models: { ...s.models, [s.provider]: e.target.value } })} />
            <datalist id="ai-cloud-models">{PROVIDERS[s.provider].suggestions.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <div className="row start">
            <button className="btn" disabled={checking} onClick={() => void test()}>Test (sends one short message)</button>
          </div>
          {s.provider === 'gemini' && <p className="ai-note">Get a Gemini API key at aistudio.google.com/apikey (it has a free tier). A Gemini app or Google One subscription doesn’t include one.</p>}
          {s.provider === 'anthropic' && <p className="ai-note">Get a Claude API key at console.anthropic.com. A claude.ai Pro or Max subscription doesn’t include one: the API is billed separately.</p>}
          {s.provider === 'openai' && <p className="ai-note">Get an OpenAI API key at platform.openai.com. A ChatGPT subscription doesn’t include one: the API is billed separately.</p>}
          <p className="ai-note">
            {isTauri()
              ? 'The key is kept in a file only this app can read, outside your notes: it is never synced, backed up or exported.'
              : 'Browser preview: the key is kept in memory only and is forgotten when the page reloads.'}
          </p>
        </>
      )}
      {check && <p className="ai-note" role="status">{check}</p>}

      <h4 className="ai-sub-head">Pictures</h4>
      <label className="set-row">
        <span>Draw pictures with</span>
        <select className="field" aria-label="Picture source" value={s.imageSource} onChange={(e) => { setImgMsg(''); setImgModels([]); saveAiSettings({ imageSource: e.target.value as ImageSource }); }}>
          {Object.values(IMAGE_SOURCES).map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <p className={'ai-note dest-' + imageDestination(s)} role="note">
        {imageDestination(s) === 'cloud'
          ? `${s.imageSource === 'gemini' ? 'Google’s' : 'OpenAI’s'} servers. Your description is sent over the internet.`
          : { local: 'A picture server on this computer. Your description never leaves it.', network: 'A picture server on another computer. Your description goes to that computer over your network.', cloud: '' }[imageDestination(s)]}
      </p>
      {s.imageSource === 'gemini' ? (
        <>
          {s.provider !== 'gemini' && <KeyRow provider="gemini" />}
          <label className="set-row">
            <span>Picture model</span>
            <input className="field" list="ai-gemini-image-models" aria-label="Gemini picture model" value={s.geminiImageModel} onChange={(e) => saveAiSettings({ geminiImageModel: e.target.value })} />
            <datalist id="ai-gemini-image-models">{['gemini-2.5-flash-image', 'imagen-4.0-generate-001'].map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <p className="ai-note">Any Gemini image model or Imagen model name from Google AI Studio works here. Image generation may need a Google AI Studio key with billing turned on; the free tier often doesn’t include it.</p>
        </>
      ) : s.imageSource === 'openai' ? (
        <>
          {s.provider !== 'openai' && <KeyRow provider="openai" />}
          <label className="set-row">
            <span>Picture model</span>
            <input className="field" aria-label="Picture model" value={s.imageModel} onChange={(e) => saveAiSettings({ imageModel: e.target.value })} />
          </label>
        </>
      ) : (
        <>
          <label className="set-row">
            <span>Server address</span>
            <input className="field" aria-label="Picture server address" value={s.imageUrls[s.imageSource]} onChange={(e) => saveAiSettings({ imageUrls: { ...s.imageUrls, [s.imageSource]: e.target.value } })} />
          </label>
          <label className="set-row">
            <span>Model (optional)</span>
            <input className="field" list="ai-image-models" aria-label="Picture server model" placeholder="the one the server has loaded" value={s.imageServerModel} onChange={(e) => saveAiSettings({ imageServerModel: e.target.value })} />
            <datalist id="ai-image-models">{imgModels.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <label className="set-row">
            <span>Picture size</span>
            <select className="field" aria-label="Picture size" value={s.imageSize} onChange={(e) => saveAiSettings({ imageSize: Number(e.target.value) })}>
              {IMAGE_SIZES.map((n) => (
                <option key={n} value={n}>{n} × {n}</option>
              ))}
            </select>
          </label>
          {s.imageSource === 'sdwebui' && (
            <label className="set-row">
              <span>Steps</span>
              <input className="field" type="number" min={1} max={150} aria-label="Sampling steps" value={s.imageSteps} onChange={(e) => saveAiSettings({ imageSteps: Number(e.target.value) })} />
            </label>
          )}
          <div className="row start">
            <button className="btn" disabled={checking} onClick={() => void checkPictureServer()}>Check connection</button>
          </div>
          <p className="ai-note">
            {s.imageSource === 'sdwebui'
              ? 'Start the server with the --api option. Which models you can use depends on what you have installed there. A bigger size or more steps takes longer, and without a graphics card a picture can take minutes.'
              : 'Use a server that offers /v1/images/generations, such as LocalAI. Which models you can use depends on what you have installed there.'}{' '}
            Check each model’s licence before using its pictures in your own work: they differ (for example FLUX.1 schnell is Apache-2.0, while others limit commercial use).
          </p>
        </>
      )}
      {imgMsg && <p className="ai-note" role="status">{imgMsg}</p>}

      <label className="set-check">
        <input type="checkbox" checked={s.confirmShare} onChange={(e) => saveAiSettings({ confirmShare: e.target.checked })} />
        <span>Show me what will be sent, and ask first, before page text goes to a cloud or network model</span>
      </label>
      <p className="ai-note">Chats are not saved anywhere: closing the panel forgets the conversation.</p>
    </div>
  );
}
