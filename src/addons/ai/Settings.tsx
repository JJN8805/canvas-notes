import { useEffect, useState } from 'react';
import { PROVIDERS, chatRequest, ollamaModelsRequest, parseOllamaModels } from '../../lib/llm/providers';
import { keys, sendRequest } from '../../lib/llm/transport';
import { destinationOf } from '../../lib/llm/url';
import { LlmError, type ProviderId } from '../../lib/llm/types';
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
          {s.provider === 'openai' && (
            <label className="set-row">
              <span>Picture model</span>
              <input className="field" aria-label="Picture model" value={s.imageModel} onChange={(e) => saveAiSettings({ imageModel: e.target.value })} />
            </label>
          )}
          <div className="row start">
            <button className="btn" disabled={checking} onClick={() => void test()}>Test (sends one short message)</button>
          </div>
          <p className="ai-note">
            {isTauri()
              ? 'The key is kept in a file only this app can read, outside your notes: it is never synced, backed up or exported.'
              : 'Browser preview: the key is kept in memory only and is forgotten when the page reloads.'}
          </p>
        </>
      )}
      {check && <p className="ai-note" role="status">{check}</p>}

      <label className="set-check">
        <input type="checkbox" checked={s.confirmShare} onChange={(e) => saveAiSettings({ confirmShare: e.target.checked })} />
        <span>Show me what will be sent, and ask first, before page text goes to a cloud or network model</span>
      </label>
      <p className="ai-note">Chats are not saved anywhere: closing the panel forgets the conversation.</p>
    </div>
  );
}
