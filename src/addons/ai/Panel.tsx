import { useEffect, useMemo, useRef, useState } from 'react';
import { PROVIDERS } from '../../lib/llm/providers';
import { destinationOf } from '../../lib/llm/url';
import { imageTargetLabel } from '../../lib/llm/image';
import { addBlock, undo, useNotes } from '../../store/notes';
import { addImages } from '../../store/images';
import { canvasApi, setSelected, useCanvas } from '../../store/canvas';
import { toast } from '../../store/ui';
import { Icon } from '../../components/ui/Icon';
import { askChat, clearChat, drawImage, hasPageText, needsConfirmation, regenerateLast, settleProposal, stopChat, useChat, wireHistory, type Message } from './chat';
import { loadAiSettings, useAiSettings } from './config';
import { buildPageContext } from './context';
import { checklistItems, markdownToHtml } from './markdown';
import { QUICK_ACTIONS, SYSTEM_PROMPT, userMessage } from './prompts';
import { buildEditableContext, EDIT_PROMPT, parseAnswer, propose, summarize, visibleText, type EditableContext } from './edits';
import { applyChanges } from './applyEdits';
import { ConfirmShare, type Pending } from './ConfirmShare';
import { b64ToFile, imageDataUrl } from './picture';

const DEST_LABEL = { local: 'On this computer', network: 'Another computer on your network', cloud: 'Cloud' } as const;

/** The page as it stood right after a proposal was applied, so Undo is only offered while nothing else has changed since. */
const afterApply = new Map<string, unknown>();

/** What the assistant wants to change: each change as before → after, applied only when the user says so. */
function Proposal({ m, pageId }: { m: Message; pageId: string }) {
  const blocks = useNotes((s) => s.pages[pageId]?.blocks);
  const parsed = useMemo(() => parseAnswer(m.content), [m.content]);
  const changes = useMemo(() => (m.aliases ? propose(parsed.ops, m.aliases, blocks ?? []) : []), [parsed, m.aliases, blocks]);
  if (!m.aliases || (!parsed.ops.length && !parsed.dropped)) return null;
  const state = m.proposal?.state;
  const ready = changes.filter((c) => !c.problem);
  const apply = () => {
    const report = applyChanges(pageId, changes, m.aliases!);
    afterApply.set(m.id, useNotes.getState().pages[pageId]?.blocks);
    const note = report.applied
      ? `Applied ${summarize(ready)}${report.skipped ? `; ${report.skipped} left out` : ''}.`
      : 'Nothing was changed: the boxes were edited after the page was sent.';
    settleProposal(m.id, { state: report.applied ? 'applied' : 'discarded', note });
    if (!report.applied) toast(note);
  };
  const canUndo = state === 'applied' && afterApply.get(m.id) === blocks;
  return (
    <div className={'ai-proposal' + (state ? ' ' + state : '')} role="group" aria-label="Suggested changes to this page">
      <div className="ai-prop-head">
        <strong>{state === 'applied' ? 'Changes applied' : state === 'discarded' ? 'Changes not applied' : 'Suggested changes: not applied yet'}</strong>
      </div>
      {!state &&
        changes.map((c, i) => (
          <div key={i} className={'ai-change' + (c.problem ? ' bad' : '')}>
            <button
              className="ai-change-title"
              disabled={!c.id || !!c.problem}
              title={c.id && !c.problem ? 'Show this box on the page' : undefined}
              onClick={() => {
                if (!c.id) return;
                setSelected([c.id]);
                canvasApi.current?.focusBlock(c.id);
              }}
            >
              {c.title}
            </button>
            {c.problem ? (
              <p className="ai-change-problem">{c.problem}</p>
            ) : (
              <>
                {c.before && (
                  <div className="ai-diff before">
                    <span>Now</span>
                    <pre>{c.before}</pre>
                  </div>
                )}
                <div className="ai-diff after">
                  <span>{c.op.kind === 'delete' ? 'Removed' : 'Becomes'}</span>
                  <pre>{c.op.kind === 'delete' ? '(the box is deleted)' : c.after || '(empty)'}</pre>
                </div>
              </>
            )}
          </div>
        ))}
      {!state && parsed.dropped > 0 && <p className="ai-change-problem">{parsed.dropped} suggestion{parsed.dropped === 1 ? ' was' : 's were'} not understood and left out.</p>}
      {!state && (
        <div className="ai-acts">
          <button className="btn small primary" disabled={!ready.length} onClick={apply}>
            Apply {ready.length ? summarize(ready) : ''}
          </button>
          <button className="btn small" onClick={() => settleProposal(m.id, { state: 'discarded', note: 'Discarded.' })}>Discard</button>
        </div>
      )}
      {state && (
        <div className="ai-acts">
          <span className="ai-note-line">{m.proposal?.note}</span>
          {canUndo && (
            <button
              className="btn small"
              onClick={() => {
                undo(pageId);
                settleProposal(m.id, { state: 'discarded', note: 'Undone: the page is back as it was.' });
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Bubble({ m, pageId, onRetry }: { m: Message; pageId: string; onRetry?: () => void }) {
  const shown = m.aliases && m.role === 'assistant' ? visibleText(m.content) : m.content;
  const items = m.role === 'assistant' && !m.imageB64 ? checklistItems(shown) : [];
  const spot = (w: number, h: number) => canvasApi.current?.visibleSpot(w, h) ?? { x: 120, y: 120 };
  const addText = () => {
    const id = addBlock(pageId, 'text', spot(420, 80), { html: markdownToHtml(shown), w: 420 });
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
        <img className="ai-img" alt={`Generated picture: ${m.content}`} src={imageDataUrl(m.imageB64)} />
      ) : (
        <div className="ai-text">{m.aliases && m.role === 'assistant' ? visibleText(m.content) : m.content}{m.streaming && <span className="ai-caret" aria-hidden="true" />}</div>
      )}
      {m.streaming && !m.content && !m.imageB64 && <div className="ai-text dim">Thinking…</div>}
      {m.shared && <div className="ai-shared">Shared this page ({m.shared.blocks} box{m.shared.blocks === 1 ? '' : 'es'}, {m.shared.chars.toLocaleString()} characters)</div>}
      {m.error && <div className="ai-error" role="alert">{m.error}</div>}
      {m.role === 'assistant' && !m.streaming && !m.error && <Proposal m={m} pageId={pageId} />}
      {onRetry && m.role === 'assistant' && !m.streaming && !m.imageB64 && (
        <div className="ai-acts">
          <button className="btn small" onClick={onRetry}>Try again</button>
        </div>
      )}
      {m.role === 'assistant' && !m.streaming && !m.error && (shown || m.imageB64) && !(m.aliases && parseAnswer(m.content).ops.length) && (
        <div className="ai-acts">
          {m.imageB64 ? (
            <button className="btn small" onClick={() => void addPicture()}>Add to page</button>
          ) : (
            <>
              <button className="btn small" onClick={addText}>Add to page</button>
              {items.length > 0 && <button className="btn small" onClick={addList}>Add as checklist</button>}
              <button className="btn small" onClick={() => void navigator.clipboard?.writeText(shown).then(() => toast('Copied'), () => toast('Couldn’t copy'))}>Copy</button>
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
  const [canEdit, setCanEdit] = useState(true);
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

  const suggest = share && canEdit;
  const ctx = useMemo(() => (share && page ? (suggest ? buildEditableContext(page, selected) : buildPageContext(page, selected)) : null), [share, suggest, page, selected]);
  const dest = destinationOf(settings.provider, settings.ollamaUrl);
  const info = PROVIDERS[settings.provider];
  const model = settings.models[settings.provider] || '(no model chosen)';
  // Pictures come from their own source (set in Settings → Add-ons), whichever model answers the chat. What you type is the whole
  // request, and the toggle names where it goes, so ticking it and sending is the consent.
  const canPicture = true;

  const go = (text: string, wire: string, shared: Message['shared'], consent: boolean, aliases?: Message['aliases']) => {
    setDraft('');
    void askChat(settings, text, { wire, shared, consent, aliases });
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
    const aliasesOf = attach && suggest ? (attach as EditableContext).aliases : undefined;
    const shared = attach ? { chars: attach.chars, blocks: attach.blocks } : undefined;
    const history = wireHistory(messages);
    const confirm = needsConfirmation({
      destination: dest, confirmShare: settings.confirmShare, newMessageHasPage: !!attach,
      historyHasPage: history.some((h) => hasPageText(h.content)), provider: settings.provider, consented,
    });
    if (confirm) setPending({ text: t, wire, shared, aliases: aliasesOf, history: history.map((h) => `${h.role === 'user' ? 'You' : 'Assistant'}: ${h.content}`) });
    else go(t, wire, shared, false, aliasesOf);
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
          messages.map((m, i) => <Bubble key={m.id} m={m} pageId={pageId} onRetry={i === messages.length - 1 && !busy ? () => void regenerateLast(settings) : undefined} />)
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
        <label className="ai-share" title="The assistant may suggest changes to the boxes on this page. Nothing changes until you press Apply, and Undo takes it back.">
          <input type="checkbox" checked={canEdit} disabled={!share} onChange={(e) => setCanEdit(e.target.checked)} />
          <span>Let the assistant suggest changes to this page (you approve each one)</span>
        </label>
        {canPicture && (
          <label className="ai-share">
            <input type="checkbox" checked={picture} onChange={(e) => setPicture(e.target.checked)} />
            <span>Draw a picture instead of answering ({imageTargetLabel(settings)})</span>
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
          system={pending.aliases ? SYSTEM_PROMPT + '\n\n' + EDIT_PROMPT : SYSTEM_PROMPT}
          onNo={() => setPending(null)}
          onYes={() => {
            const p = pending;
            setPending(null);
            go(p.text, p.wire, p.shared, true, p.aliases);
          }}
        />
      )}
    </aside>
  );
}
