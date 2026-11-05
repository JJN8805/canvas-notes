import { useEffect, useMemo, useRef, useState } from 'react';
import { PROVIDERS } from '../../lib/llm/providers';
import { destinationOf } from '../../lib/llm/url';
import { libraryPages } from '../../lib/pages';
import { navigate } from '../../lib/route';
import { newId } from '../../lib/util';
import { createPage, useNotes } from '../../store/notes';
import { toast } from '../../store/ui';
import { Icon } from '../../components/ui/Icon';
import type { Block } from '../../types';
import { buildAttachments, MAX_ATTACHED, titleFromAnswer } from './attach';
import { hasPageText, mainChat, needsConfirmation, wireHistory, type Message } from './chat';
import { useChatInbox } from './chatInbox';
import { loadAiSettings, useAiSettings } from './config';
import { ConfirmShare, type Pending } from './ConfirmShare';
import { markdownToHtml } from './markdown';
import { userMessage } from './prompts';

const DEST_LABEL = { local: 'On this computer', network: 'Another computer on your network', cloud: 'Cloud' } as const;

const STARTERS: { label: string; draft: string; pickPages: boolean }[] = [
  { label: 'Summarize a page', draft: 'Summarize this page in a few short bullet points.', pickPages: true },
  { label: 'Find action items in a page', draft: 'Find the action items: things someone needs to do. One per line, each starting with "- [ ] ".', pickPages: true },
  { label: 'Brainstorm ideas', draft: 'Brainstorm ideas for ', pickPages: false },
  { label: 'Explain something simply', draft: 'Explain this simply: ', pickPages: false },
];

/** Page titles to choose from, newest first, narrowed by what was typed. */
function PagePicker({ chosen, onToggle, onClose }: { chosen: string[]; onToggle: (id: string) => void; onClose: () => void }) {
  const pages = useNotes((s) => s.pages);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return libraryPages(pages)
      .filter((p) => words.every((w) => (p.title || 'untitled').toLowerCase().includes(w)))
      .sort((a, b) => b.updated - a.updated)
      .slice(0, 40);
  }, [pages, q]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <div className="chat-picker" role="dialog" aria-label="Add pages to this question">
      <input autoFocus className="field" aria-label="Find a page to add" placeholder="Find a page…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="chat-picker-list">
        {list.map((p) => {
          const on = chosen.includes(p.id);
          return (
            <li key={p.id}>
              <button className={'chat-picker-row' + (on ? ' on' : '')} aria-pressed={on} disabled={!on && chosen.length >= MAX_ATTACHED} onClick={() => onToggle(p.id)}>
                <span className="chat-check" aria-hidden="true">{on ? '✓' : ''}</span>
                <span className="lbl">{p.title || 'Untitled'}</span>
              </button>
            </li>
          );
        })}
        {!list.length && <li className="chat-picker-empty">No pages match.</li>}
      </ul>
      <div className="chat-picker-foot">
        <span>{chosen.length} of {MAX_ATTACHED} chosen</span>
        <button className="btn small primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function ChatMessage({ m, last, canRetry, onRetry }: { m: Message; last: boolean; canRetry: boolean; onRetry: () => void }) {
  const saveAsPage = () => {
    const block = { id: newId(), type: 'text', x: 80, y: 80, w: 640, h: 120, z: 1, html: markdownToHtml(m.content) } as Block;
    const page = createPage({ title: titleFromAnswer(m.content), blocks: [block] });
    toast('Saved as a new page', { label: 'Open', run: () => navigate({ name: 'page', id: page.id }) });
  };
  return (
    <div className={'chat-msg ' + m.role + (m.error ? ' err' : '')}>
      {m.role === 'assistant' && m.content ? (
        // The answer's Markdown (headings, lists, bold, code) shown formatted. The converter escapes everything first, so a reply can't add markup of its own.
        <div className="chat-bubble md">
          <div dangerouslySetInnerHTML={{ __html: markdownToHtml(m.content) }} />
          {m.streaming && <span className="ai-caret" aria-hidden="true" />}
        </div>
      ) : (
        <div className="chat-bubble">
          {m.content || (m.streaming ? <span className="dim">Thinking…</span> : null)}
          {m.streaming && <span className="ai-caret" aria-hidden="true" />}
        </div>
      )}
      {m.sharedPages && m.sharedPages.length > 0 && <div className="ai-shared">Shared {m.sharedPages.length === 1 ? 'the page' : `${m.sharedPages.length} pages`}: {m.sharedPages.join(', ')}</div>}
      {m.error && <div className="ai-error" role="alert">{m.error}</div>}
      {m.role === 'assistant' && !m.streaming && (
        <div className="ai-acts">
          {m.content && !m.error && (
            <>
              <button className="btn small" onClick={saveAsPage}>Save as a page</button>
              <button className="btn small" onClick={() => void navigator.clipboard?.writeText(m.content).then(() => toast('Copied'), () => toast('Couldn’t copy'))}>Copy</button>
            </>
          )}
          {last && canRetry && <button className="btn small" onClick={onRetry}>Try again</button>}
        </div>
      )}
    </div>
  );
}

/**
 * The Chat screen: a conversation that isn't tied to one page. Add up to five pages to a question to talk about them.
 * Nothing is saved: the conversation lasts until "New chat" or until the app is closed.
 */
export function ChatView() {
  const { settings, loaded } = useAiSettings();
  const { messages, busy, consented } = mainChat.useStore();
  const pages = useNotes((s) => s.pages);
  const inbox = useChatInbox((s) => s.question);
  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<{ pending: Pending; go: () => void } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loaded) void loadAiSettings();
    inputRef.current?.focus();
  }, [loaded]);
  // Keep the newest text in view as it arrives. This scrolls to the real bottom of the screen, where the message box sits below the
  // conversation; aligning the last line with the screen edge would leave it behind the (sticky) message box. If the reader has scrolled
  // up to read something, new text does not pull them down.
  const scroller = useRef<HTMLElement | null>(null);
  const follow = useRef(true);
  useEffect(() => {
    const el = endRef.current?.closest('.main') as HTMLElement | null;
    scroller.current = el;
    if (!el) return;
    const onScroll = () => {
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  // Escape stops an answer being written.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && busy && !pending && !picking) mainChat.stop();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, pending, picking]);

  const dest = destinationOf(settings.provider, settings.ollamaUrl);
  const info = PROVIDERS[settings.provider];
  const model = settings.models[settings.provider] || '(no model chosen)';
  const attachments = useMemo(() => buildAttachments(pages, attached), [pages, attached]);

  const send = (text: string, ids: string[] = attached) => {
    const t = text.trim();
    if (!t || busy || !loaded) return;
    const att = buildAttachments(pages, ids);
    const wire = userMessage(t, att.texts);
    const shared = att.texts.length ? { chars: att.chars, blocks: att.texts.length } : undefined;
    const history = wireHistory(messages);
    const go = (consent: boolean) => {
      setDraft('');
      follow.current = true; // asking something always brings you to the answer
      setAttached([]); // the pages are in the conversation now; add more only if the next question needs them
      void mainChat.ask(settings, t, { wire, shared, sharedPages: att.titles.length ? att.titles : undefined, consent });
    };
    const confirm = needsConfirmation({
      destination: dest, confirmShare: settings.confirmShare, newMessageHasPage: att.texts.length > 0,
      historyHasPage: history.some((h) => hasPageText(h.content)), provider: settings.provider, consented,
    });
    if (confirm) setPending({ pending: { text: t, wire, shared, history: history.map((h) => `${h.role === 'user' ? 'You' : 'Assistant'}: ${h.content}`) }, go: () => go(true) });
    else go(false);
  };

  // A question typed into "Search or ask" is asked here as soon as the screen is ready.
  useEffect(() => {
    if (inbox && loaded && !busy) {
      useChatInbox.setState({ question: null });
      send(inbox, []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox, loaded]);

  const toggle = (id: string) => setAttached((a) => (a.includes(id) ? a.filter((x) => x !== id) : a.length >= MAX_ATTACHED ? a : [...a, id]));
  const titleOf = (id: string) => pages[id]?.title?.trim() || 'Untitled';

  return (
    <div className="chatview">
      <div className="main-head">
        <div className="main-title">
          <h1>Chat</h1>
          <p>
            {info.label} · {model}
          </p>
        </div>
        <div className="controls">
          <span className={'ai-badge dest-' + dest} title={info.label}>{DEST_LABEL[dest]}</span>
          <button className="btn" disabled={!messages.length && !busy} onClick={() => mainChat.clear()} title="Forget this conversation and start again">
            <Icon name="plus" size={16} />
            New chat
          </button>
        </div>
      </div>

      <div className="chat-list" aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <h2>What can I help with?</h2>
            <p>Ask anything, or add pages to talk about them. Chats aren’t saved: they’re forgotten when you start a new chat or close the app.</p>
            <div className="chat-starters">
              {STARTERS.map((s) => (
                <button
                  key={s.label}
                  className="btn"
                  onClick={() => {
                    setDraft(s.draft);
                    if (s.pickPages) setPicking(true);
                    inputRef.current?.focus();
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => <ChatMessage key={m.id} m={m} last={i === messages.length - 1} canRetry={!busy} onRetry={() => { follow.current = true; void mainChat.regenerate(settings); }} />)
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-composer">
        {picking && <PagePicker chosen={attached} onToggle={toggle} onClose={() => setPicking(false)} />}
        {attached.length > 0 && (
          <div className="chat-chips" aria-label="Pages added to this question">
            {attached.filter((id) => pages[id]).map((id) => (
              <span key={id} className="chip">
                {titleOf(id)}
                <button className="chip-x" aria-label={`Remove ${titleOf(id)}`} onClick={() => toggle(id)}>×</button>
              </span>
            ))}
            <span className="chat-chars">{attachments.chars.toLocaleString()} characters{attachments.truncated ? ', shortened' : ''}</span>
          </div>
        )}
        <div className="chat-inputrow">
          <textarea
            ref={inputRef}
            aria-label="Message"
            placeholder="Ask anything…"
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
          <div className="chat-btns">
            <button className="btn" onClick={() => setPicking((p) => !p)} aria-expanded={picking} title="Add pages to talk about">
              <Icon name="pages" size={16} />
              Add pages{attached.length ? ` (${attached.length})` : ''}
            </button>
            {busy ? (
              <button className="btn" onClick={() => mainChat.stop()}>Stop</button>
            ) : (
              <button className="btn primary" disabled={!draft.trim() || !loaded} onClick={() => send(draft)}>Send</button>
            )}
          </div>
        </div>
      </div>

      {pending && (
        <ConfirmShare
          pending={pending.pending}
          to={info.label}
          onNo={() => setPending(null)}
          onYes={() => {
            const go = pending.go;
            setPending(null);
            go();
          }}
        />
      )}
    </div>
  );
}
