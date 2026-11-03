import { useEffect, useMemo, useRef, useState } from 'react';
import { PROVIDERS } from '../../lib/llm/providers';
import { destinationOf } from '../../lib/llm/url';
import { addBlock, useNotes } from '../../store/notes';
import { addImages } from '../../store/images';
import { canvasApi, setSelected, useCanvas } from '../../store/canvas';
import { toast } from '../../store/ui';
import { Icon } from '../../components/ui/Icon';
import { askChat, clearChat, drawImage, hasPageText, needsConfirmation, stopChat, useChat, wireHistory, type Message } from './chat';
import { loadAiSettings, useAiSettings } from './config';
import { buildPageContext } from './context';
import { checklistItems, markdownToHtml } from './markdown';
import { QUICK_ACTIONS, SYSTEM_PROMPT, userMessage } from './prompts';
import { b64ToFile } from './picture';

const DEST_LABEL = { local: 'On this computer', network: 'Another computer on your network', cloud: 'Cloud' } as const;

interface Pending {
  text: string;
  wire: string;
  shared?: Message['shared'];
  history: string[];
}

/** What is about to go to a cloud or network model, shown in full, with a button to send it or not. */
function ConfirmShare({ pending, to, onYes, onNo }: { pending: Pending; to: string; onYes: () => void; onNo: () => void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => yes.current?.focus(), []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onNo()}>
      <div className="dialog ai-confirm" role="dialog" aria-modal="true" aria-label={`Send to ${to}?`} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onNo())}>
        <h2>Send this to {to}?</h2>
        <p>This is everything that will leave your computer for this message. Your notes are not sent unless they appear below.</p>
        <details>
          <summary>Instructions the app adds</summary>
          <pre className="ai-preview">{SYSTEM_PROMPT}</pre>
        </details>
        {pending.history.length > 0 && (
          <details>
            <summary>Earlier messages in this chat ({pending.history.length}) that go along</summary>
            <pre className="ai-preview">{pending.history.join('\n\n———\n\n')}</pre>
          </details>
        )}
        <pre className="ai-preview" aria-label="The message">{pending.wire}</pre>
        <div className="row">
          <button className="btn" onClick={onNo}>Don’t send</button>
          <button ref={yes} className="btn primary" onClick={onYes}>Send to {to}</button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ m, pageId }: { m: Message; pageId: string }) {
  const items = m.role === 'assistant' && !m.imageB64 ? checklistItems(m.content) : [];
  const spot = (w: number, h: number) => canvasApi.current?.visibleSpot(w, h) ?? { x: 120, y: 120 };
  const addText = () => {
    const id = addBlock(pageId, 'text', spot(420, 80), { html: markdownToHtml(m.content), w: 420 });
    if (id) setSelected([id]);
  };
  const addList = () => {
    const id = addBlock(pageId, 'checklist', spot(300, 80), { items: items.map((text, i) => ({ id: `ai${Date.now().toString(36)}${i}`, text, done: false })) });
    if (id) setSelected([id]);
  };
  const addPicture = async () => {
    const ids = await addImages(pageId, [b64ToFile(m.imageB64!, 'AI picture.png')], spot(360, 360));
    if (ids.length) setSelected(ids);
  };
  return (
    <div className={'ai-msg ' + m.role + (m.error ? ' err' : '')}>
      {m.imageB64 ? (
        <img className="ai-img" alt={`Generated picture: ${m.content}`} src={`data:image/png;base64,${m.imageB64}`} />
      ) : (
        <div className="ai-text">{m.content}{m.streaming && <span className="ai-caret" aria-hidden="true" />}</div>
      )}
      {m.streaming && !m.content && !m.imageB64 && <div className="ai-text dim">Thinking…</div>}
      {m.shared && <div className="ai-shared">Shared this page ({m.shared.blocks} box{m.shared.blocks === 1 ? '' : 'es'}, {m.shared.chars.toLocaleString()} characters)</div>}
      {m.error && <div className="ai-error" role="alert">{m.error}</div>}
      {m.role === 'assistant' && !m.streaming && !m.error && (m.content || m.imageB64) && (
        <div className="ai-acts">
          {m.imageB64 ? (
            <button className="btn small" onClick={() => void addPicture()}>Add to page</button>
          ) : (
            <>
              <button className="btn small" onClick={addText}>Add to page</button>
              {items.length > 0 && <button className="btn small" onClick={addList}>Add as checklist</button>}
              <button className="btn small" onClick={() => void navigator.clipboard?.writeText(m.content).then(() => toast('Copied'), () => toast('Couldn’t copy'))}>Copy</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The assistant: a drawer beside the page. Nothing in it is saved; closing it forgets the chat. */
export function AiPanel({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const { settings, loaded } = useAiSettings();
  const { messages, busy, consented } = useChat();
  const page = useNotes((s) => s.pages[pageId]);
  const selected = useCanvas((s) => s.selected);
  const [share, setShare] = useState(true);
  const [draft, setDraft] = useState('');
  const [picture, setPicture] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loaded) void loadAiSettings();
    inputRef.current?.focus();
    return () => clearChat(); // closing the panel (or leaving the page) forgets the conversation
  }, [loaded]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !pending && !(e.target instanceof HTMLElement && e.target.closest('.dialog')) && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, pending]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const ctx = useMemo(() => (share && page ? buildPageContext(page, selected) : null), [share, page, selected]);
  const dest = destinationOf(settings.provider, settings.ollamaUrl);
  const info = PROVIDERS[settings.provider];
  const model = settings.models[settings.provider] || '(no model chosen)';
  const canPicture = settings.provider === 'openai';

  const go = (text: string, wire: string, shared: Message['shared'], consent: boolean) => {
    setDraft('');
    void askChat(settings, text, { wire, shared, consent });
  };

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    if (picture && canPicture) {
      setDraft('');
      void drawImage(settings, t);
      return;
    }
    const attach = ctx && ctx.text.trim() ? ctx : null;
    const wire = userMessage(t, attach?.text);
    const shared = attach ? { chars: attach.chars, blocks: attach.blocks } : undefined;
    const history = wireHistory(messages);
    const confirm = needsConfirmation({
      destination: dest, confirmShare: settings.confirmShare, newMessageHasPage: !!attach,
      historyHasPage: history.some((h) => hasPageText(h.content)), provider: settings.provider, consented,
    });
    if (confirm) setPending({ text: t, wire, shared, history: history.map((h) => `${h.role === 'user' ? 'You' : 'Assistant'}: ${h.content}`) });
    else go(t, wire, shared, false);
  };

  return (
    <aside className="ai-panel" aria-label="AI assistant">
      <header className="ai-head">
        <div className="ai-title">
          <Icon name="sparkle" size={16} />
          <strong>Assistant</strong>
          <span className={'ai-badge dest-' + dest} title={`${info.label} · ${model}`}>{DEST_LABEL[dest]}</span>
        </div>
        <div className="ai-head-btns">
          <button className="btn small" disabled={!messages.length} onClick={clearChat} title="Forget this conversation">New chat</button>
          <button className="btn small" onClick={onClose} aria-label="Close assistant">Close</button>
        </div>
      </header>
      <div className="ai-sub">{info.label} · {model}</div>

      <div className="ai-list" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="ai-empty">
            <p>Ask about this page, or have the assistant write something for it. Chats aren’t saved: closing this panel forgets them.</p>
            <div className="ai-quick">
              {QUICK_ACTIONS.map((a) => (
                <button key={a.id} className="btn small" disabled={busy || (a.needsPage && !(ctx && ctx.text.trim()))} onClick={() => send(a.prompt)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} pageId={pageId} />)
        )}
      </div>

      <div className="ai-foot">
        <label className="ai-share">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          <span>
            {share && ctx && ctx.text.trim()
              ? `Share ${ctx.usedSelection ? 'the selected boxes' : 'this page'} (${ctx.blocks} box${ctx.blocks === 1 ? '' : 'es'}, ${ctx.chars.toLocaleString()} characters${ctx.truncated ? ', shortened' : ''})`
              : 'Share this page with each message'}
          </span>
        </label>
        {canPicture && (
          <label className="ai-share">
            <input type="checkbox" checked={picture} onChange={(e) => setPicture(e.target.checked)} />
            <span>Draw a picture instead of answering</span>
          </label>
        )}
        <div className="ai-input">
          <textarea
            ref={inputRef}
            aria-label="Message to the assistant"
            placeholder={picture && canPicture ? 'Describe the picture' : 'Ask something…'}
            rows={2}
            value={draft}
            disabled={!loaded}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          {busy ? (
            <button className="btn" onClick={stopChat}>Stop</button>
          ) : (
            <button className="btn primary" disabled={!draft.trim()} onClick={() => send(draft)}>Send</button>
          )}
        </div>
      </div>

      {pending && (
        <ConfirmShare
          pending={pending}
          to={info.label}
          onNo={() => setPending(null)}
          onYes={() => {
            const p = pending;
            setPending(null);
            go(p.text, p.wire, p.shared, true);
          }}
        />
      )}
    </aside>
  );
}
