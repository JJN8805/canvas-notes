import { useEffect, useState } from 'react';
import { ollamaModelsRequest, parseOllamaModels } from '../../../lib/llm/providers';
import { keys, sendRequest } from '../../../lib/llm/transport';
import { LlmError } from '../../../lib/llm/types';
import { confirmDanger } from '../../../store/ui';
import { agreeToCloudEmbedding, ragReady, saveRag, useRagSettings } from './config';
import { EMBED_SOURCES, isCloudEmbedding, type EmbedSource } from './embedApi';
import { indexNow, rebuildIndex } from './runtime';
import { useRagStatus } from './status';

/** What a cloud source receives, said plainly before the person agrees. */
export const CLOUD_EMBED_WARNING = (name: string) =>
  `To search by meaning with ${name}, the text of every page in your library is sent to ${name} to be turned into numbers (embeddings), now and each time you edit a page, and every question you search for is sent too. ` +
  'This is separate from the chat model and does not ask again for each page. Nothing is sent until you press the button below, and you can switch back to your own computer at any time (your notes are not changed either way).';

/** Settings → Add-ons → AI assistant → "Search my notes by meaning". */
export function RagSettings() {
  const s = useRagSettings((x) => x.settings);
  const status = useRagStatus();
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const source = s.embed.source;
  const cloud = isCloudEmbedding(source);
  const ready = ragReady(s);

  useEffect(() => {
    if (!cloud) return void setHasKey(null);
    void keys.has(source as 'openai' | 'gemini').then(setHasKey, () => setHasKey(false));
  }, [source, cloud]);

  const pickSource = async (next: EmbedSource) => {
    if (next === source) return;
    if (!isCloudEmbedding(next)) return saveRag({ embed: { source: next } });
    const name = EMBED_SOURCES[next].label;
    const ok = await confirmDanger(`Send your notes to ${name}?`, CLOUD_EMBED_WARNING(name), `Send my notes to ${name}`);
    if (ok) agreeToCloudEmbedding(next);
  };

  const findModels = async () => {
    setMsg('');
    try {
      const found = parseOllamaModels(await sendRequest(ollamaModelsRequest({ ollamaUrl: s.embed.ollamaUrl })));
      setModels(found);
      setMsg(found.length ? `Found ${found.length} model${found.length === 1 ? '' : 's'}. Pick one made for embeddings (such as nomic-embed-text).` : 'Ollama has no models yet. Install an embedding model with: ollama pull nomic-embed-text');
    } catch (e) {
      setMsg(e instanceof LlmError ? e.message : 'Couldn’t reach Ollama.');
    }
  };

  const pct = status.total ? Math.round((status.done / status.total) * 100) : 0;
  return (
    <div className="rag-settings">
      <h4>Search my notes by meaning</h4>
      <p className="ai-note">
        “Search my notes” and the assistants can find passages by what they mean, not only by the words they use (a question about “spending” finds a note about “cutting costs”). Each passage is turned into numbers, kept only on this device
        and never synced or backed up, and rebuilt when you change the model.
      </p>
      <label className="set-check">
        <input type="checkbox" checked={s.semantic} onChange={(e) => saveRag({ semantic: e.target.checked })} />
        <span>Search by meaning as well as by words</span>
      </label>
      {s.semantic && (
        <>
          <label className="set-row">
            <span>Made by</span>
            <select className="field" aria-label="Where embeddings are made" value={source} onChange={(e) => void pickSource(e.target.value as EmbedSource)}>
              {(Object.keys(EMBED_SOURCES) as EmbedSource[]).map((k) => (
                <option key={k} value={k}>{EMBED_SOURCES[k].label}{EMBED_SOURCES[k].cloud ? ' (sends your notes)' : ''}</option>
              ))}
            </select>
          </label>
          {cloud ? (
            <p className="ai-note rag-cloud" role="note">
              Your notes and questions are sent to {EMBED_SOURCES[source].label} for this. You agreed to that; switch to “This computer” to stop. {hasKey === false ? `Add your ${EMBED_SOURCES[source].label} API key in the provider section above, or nothing can be indexed.` : ''}
            </p>
          ) : (
            <p className="ai-note rag-local">Made by Ollama. Nothing leaves your computer (unless the address below is another computer).</p>
          )}
          {!cloud && (
            <label className="set-row">
              <span>Ollama address</span>
              <input className="field" aria-label="Ollama address for embeddings" value={s.embed.ollamaUrl} onChange={(e) => saveRag({ embed: { ollamaUrl: e.target.value } })} />
            </label>
          )}
          <label className="set-row">
            <span>Embedding model</span>
            <input className="field" aria-label="Embedding model" list="rag-models" value={s.embed.models[source]} onChange={(e) => saveRag({ embed: { models: { ...s.embed.models, [source]: e.target.value } } })} />
            <datalist id="rag-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          {!cloud && (
            <div className="row start">
              <button className="btn" onClick={() => void findModels()}>Find models</button>
            </div>
          )}
          {msg && <p className="ai-note" role="status">{msg}</p>}
          <div className="rag-status" role="status" aria-label="Index status">
            {status.state === 'off' && <span className="ai-note">{status.note || (ready.ok ? 'Starting…' : 'Not running.')}</span>}
            {status.state === 'idle' && <span className="ai-status ok">Up to date: {status.total.toLocaleString()} passages indexed.</span>}
            {status.state === 'indexing' && (
              <>
                <span className="ai-note">Indexing your notes: {status.done.toLocaleString()} of {status.total.toLocaleString()} ({pct}%). You can keep working.</span>
                <progress max={status.total || 1} value={status.done} aria-label="Indexing progress" />
              </>
            )}
            {status.state === 'error' && <span className="ai-note rag-error">Stopped: {status.error}</span>}
          </div>
          <div className="row start">
            <button className="btn" disabled={!ready.ok || status.state === 'indexing'} onClick={() => void indexNow()}>Index now</button>
            <button className="btn" disabled={!ready.ok || status.state === 'indexing'} onClick={() => void rebuildIndex()}>Rebuild from scratch</button>
          </div>
        </>
      )}
      <label className="set-check">
        <input type="checkbox" checked={s.assistantNotes} onChange={(e) => saveRag({ assistantNotes: e.target.checked })} />
        <span>The assistant drawer starts with “Also search my other notes” on</span>
      </label>
      <label className="set-check">
        <input type="checkbox" checked={s.inlineNotes} onChange={(e) => saveRag({ inlineNotes: e.target.checked })} />
        <span>“Write with AI” may use related passages from my other pages as reference</span>
      </label>
      <p className="ai-note">Passages found for a question are the only note text sent to a cloud or network chat model, and you see them first (unless you turned that off above).</p>
    </div>
  );
}
