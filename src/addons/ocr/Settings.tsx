import { useEffect, useState } from 'react';
import { ollamaModelsRequest, parseOllamaModels } from '../../lib/llm/providers';
import { sendRequest } from '../../lib/llm/transport';
import { loadOcrSettings, saveOcrSettings, useOcrSettings } from './config';
import { localOllamaBase } from './ocr';

export function OcrSettings() {
  const { settings: s, loaded } = useOcrSettings();
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!loaded) void loadOcrSettings();
  }, [loaded]);
  let addressProblem = '';
  try {
    localOllamaBase(s.url);
  } catch (e) {
    addressProblem = e instanceof Error ? e.message : '';
  }
  const find = async () => {
    setBusy(true);
    setMsg('');
    try {
      localOllamaBase(s.url);
      const found = parseOllamaModels(await sendRequest(ollamaModelsRequest({ ollamaUrl: s.url })));
      setModels(found);
      setMsg(found.length ? `Found ${found.length} model${found.length === 1 ? '' : 's'}. Pick one that can read pictures.` : 'Ollama has no models yet. Pull a vision model, e.g. “ollama pull llama3.2-vision”.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Couldn’t reach Ollama.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ai-settings">
      <label className="set-row">
        <span>Ollama address</span>
        <input className="field" aria-label="Ollama address for OCR" value={s.url} onChange={(e) => saveOcrSettings({ url: e.target.value })} />
      </label>
      {addressProblem && <p className="ai-note dest-network" role="alert">{addressProblem}</p>}
      <label className="set-row">
        <span>Vision model</span>
        <input className="field" list="ocr-models" aria-label="Vision model" placeholder="e.g. llama3.2-vision, qwen2.5vl, minicpm-v" value={s.model} onChange={(e) => saveOcrSettings({ model: e.target.value })} />
        <datalist id="ocr-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      <div className="row start">
        <button className="btn" disabled={busy || !!addressProblem} onClick={() => void find()}>Find models</button>
      </div>
      {msg && <p className="ai-note" role="status">{msg}</p>}
      <p className="ai-note">Pictures are sent only to Ollama on this computer. The text it reads is saved on the picture’s box (and syncs with the page) so search can find it. Use <strong>Extract text</strong> on a picture’s hover bar, or “Extract text from the pictures on this page” in the command palette.</p>
    </div>
  );
}
