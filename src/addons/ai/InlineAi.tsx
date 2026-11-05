import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { PROVIDERS } from '../../lib/llm/providers';
import { destinationOf } from '../../lib/llm/url';
import type { ChatMsg } from '../../lib/llm/types';
import { useRoute } from '../../lib/route';
import { useNotes } from '../../store/notes';
import { toast } from '../../store/ui';
import { Icon } from '../../components/ui/Icon';
import { needsConfirmation } from './chat';
import { loadAiSettings, useAiSettings } from './config';
import { buildPageContext } from './context';
import { ConfirmShare, type Pending } from './ConfirmShare';
import { applyToEditor, closeInlineAi, insertAsBox, insertAsChecklist, insertWritten, openInlineAi, useInlineAi, type ApplyResult, type InlineTarget, type Placement } from './inline';
import { checklistItems } from './markdown';
import { userMessage } from './prompts';
import { streamChat } from './stream';
import { EDIT_SYSTEM, LANGUAGES, MAIN_TASKS, MORE_TASKS, TONES, WRITE_SUGGESTIONS, WRITE_SYSTEM, editMessage, refineMessage, toneTask, translateTask, type AiTask } from './tasks';

const DEST_LABEL = { local: 'On this computer', network: 'Another computer on your network', cloud: 'Cloud' } as const;

/** The ✨ button in the text formatting bar. */
export function InlineAiFormatTool({ editor }: { editor: Editor }) {
  const route = useRoute();
  return (
    <button
      aria-label="Edit with AI"
      title="Edit the selected text (or this whole box) with AI"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => openInlineAi(editor, route.name === 'page' ? route.id : null)}
    >
      <Icon name="sparkle" size={15} />
      <span style={{ marginLeft: 4 }}>AI</span>
    </button>
  );
}

/** Mounted once for the app: shows the card while there is a target. */
export function InlineAiHost() {
  const target = useInlineAi((s) => s.target);
  const route = useRoute();
  const here = route.name === 'page' ? route.id : null;
  // Leaving the page the card was opened on closes it.
  useEffect(() => {
    if (target && target.pageId !== here) closeInlineAi();
  }, [target, here]);
  return target ? <InlineAiCard key={target.id} target={target} /> : null;
}

type Phase = 'pick' | 'working' | 'done';

function InlineAiCard({ target }: { target: InlineTarget }) {
  const { settings, loaded } = useAiSettings();
  const edit = target.mode === 'edit';
  const page = useNotes((s) => (target.pageId ? s.pages[target.pageId] : undefined));
  const [phase, setPhase] = useState<Phase>('pick');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [first, setFirst] = useState<{ system: string; messages: ChatMsg[]; where: Placement } | null>(null);
  const [convo, setConvo] = useState<ChatMsg[]>([]); // what to continue from when refining
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [sharePage, setSharePage] = useState(true);
  const [pending, setPending] = useState<{ pending: Pending; go: () => void } | null>(null);
  const [consented, setConsented] = useState(false);
  const [where, setWhere] = useState<Placement>('replace');
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loaded) void loadAiSettings();
    input.current?.focus();
    return () => abort.current?.abort();
  }, [loaded]);

  const working = phase === 'working';
  const workingRef = useRef(false);
  workingRef.current = working;
  const pendingRef = useRef(false);
  pendingRef.current = !!pending;
  // Escape stops an answer being written, or closes the card. It listens on the page because the focus can be anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || pendingRef.current) return;
      e.stopPropagation();
      if (workingRef.current) abort.current?.abort();
      else closeInlineAi();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const dest = destinationOf(settings.provider, settings.ollamaUrl);
  const info = PROVIDERS[settings.provider];
  const pageCtx = useMemo(() => (!edit && page ? buildPageContext(page, []) : null), [edit, page]);

  /** Sends `messages`. `leaves` = text from the user's notes is in them (so a cloud or network model needs the user's say-so). */
  const start = (system: string, messages: ChatMsg[], placement: Placement, leaves: boolean) => {
    const run = async () => {
      setConsented(true);
      setPhase('working');
      setError('');
      setAnswer('');
      const mine = (abort.current = new AbortController());
      let latest = '';
      try {
        latest = await streamChat(settings, system, messages, { signal: mine.signal, onText: (t) => setAnswer(t) });
        setAnswer(latest);
        setConvo([...messages, { role: 'assistant', content: latest }]);
        setPhase(latest ? 'done' : 'pick');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setPhase(latest ? 'done' : 'pick');
      } finally {
        if (abort.current === mine) abort.current = null;
      }
    };
    setFirst((f) => (f && messages.length > 1 ? f : { system, messages, where: placement }));
    setWhere(placement);
    const confirm = needsConfirmation({
      destination: dest, confirmShare: settings.confirmShare, newMessageHasPage: leaves,
      historyHasPage: messages.length > 1, provider: settings.provider, consented: consented ? settings.provider : null,
    });
    if (confirm) {
      const last = messages[messages.length - 1].content;
      setPending({ pending: { text: last, wire: last, history: [] }, go: () => void run() });
    } else void run();
  };

  const runEditTask = (task: AiTask, instruction = task.instruction) => start(EDIT_SYSTEM, [{ role: 'user', content: editMessage(instruction, target.original) }], task.where, true);
  const runFree = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    if (edit) runEditTask({ id: 'free', label: text, where: 'replace', instruction: text });
    else {
      const attach = sharePage && pageCtx && pageCtx.text.trim() ? pageCtx.text : undefined;
      start(WRITE_SYSTEM, [{ role: 'user', content: userMessage(text, attach) }], 'below', !!attach);
    }
  };
  const runSuggestion = (prompt: string) => {
    const attach = sharePage && pageCtx && pageCtx.text.trim() ? pageCtx.text : undefined;
    start(WRITE_SYSTEM, [{ role: 'user', content: userMessage(prompt, attach) }], 'below', !!attach);
  };
  const refine = () => {
    const text = draft.trim();
    if (!text || !first) return;
    setDraft('');
    start(first.system, [...convo, { role: 'user', content: refineMessage(text) }], where, false);
  };
  const again = () => first && start(first.system, first.messages.slice(0, 1), first.where, edit || /<page>/.test(first.messages[0].content));

  const finish = (r: ApplyResult) => {
    if (r.ok) closeInlineAi();
    else toast(r.problem ?? 'That didn’t work.');
  };
  const tasks = (items: readonly AiTask[]) =>
    items.map((t) => (
      <button key={t.id} className="btn small" onClick={() => runEditTask(t)}>
        {t.label}
      </button>
    ));
  const preview = target.original.length > 180 ? target.original.slice(0, 180).trimEnd() + '…' : target.original;
  const hasTasks = checklistItems(answer).length > 0;
  const other: Placement = where === 'replace' ? 'below' : 'replace';
  const replaceLabel = target.whole ? 'Replace text' : 'Replace selection';
  const labelOf = (p: Placement) => (p === 'replace' ? replaceLabel : 'Insert below');

  return (
    <div className="ai-card" role="dialog" aria-label={edit ? 'Edit with AI' : 'Write with AI'}>
      <header className="ai-card-head">
        <div className="ai-title">
          <Icon name="sparkle" size={16} />
          <strong>{edit ? 'Edit with AI' : 'Write with AI'}</strong>
          <span className={'ai-badge dest-' + dest} title={info.label}>{DEST_LABEL[dest]}</span>
        </div>
        <button className="btn small" aria-label="Close AI" onClick={closeInlineAi}>Close</button>
      </header>

      {edit && <blockquote className="ai-quote" aria-label="The text">{target.whole ? 'This whole text box: ' : ''}{preview}</blockquote>}

      {phase === 'pick' && (
        <>
          <input
            ref={input}
            className="field ai-ask"
            aria-label={edit ? 'Tell AI what to do with this text' : 'Ask AI to write anything'}
            placeholder={edit ? 'Tell AI what to do with this text…' : 'Ask AI to write anything…'}
            value={draft}
            disabled={!loaded}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (e.preventDefault(), runFree())}
          />
          {edit ? (
            <>
              <div className="ai-tasks">{tasks(MAIN_TASKS)}</div>
              <button className="btn small ai-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>{more ? 'Fewer options' : 'More…'}</button>
              {more && (
                <div className="ai-morebox">
                  <div className="ai-tasks">{tasks(MORE_TASKS)}</div>
                  <div className="ai-group-label">Change tone</div>
                  <div className="ai-tasks">{tasks(TONES.map(toneTask))}</div>
                  <div className="ai-group-label">Translate to</div>
                  <div className="ai-tasks">{tasks(LANGUAGES.map(translateTask))}</div>
                </div>
              )}
            </>
          ) : (
            <>
              {pageCtx && pageCtx.text.trim() && (
                <label className="ai-share">
                  <input type="checkbox" checked={sharePage} onChange={(e) => setSharePage(e.target.checked)} />
                  <span>Use this page as context ({pageCtx.chars.toLocaleString()} characters{pageCtx.truncated ? ', shortened' : ''})</span>
                </label>
              )}
              <div className="ai-suggest" role="list">
                {WRITE_SUGGESTIONS.map((s) => (
                  <button key={s.id} role="listitem" className="ai-suggestion" disabled={s.needsPage && !(sharePage && pageCtx && pageCtx.text.trim())} onClick={() => runSuggestion(s.prompt)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {(working || phase === 'done') && (
        <>
          <div className="ai-result" aria-live="polite">{answer || 'Thinking…'}{working && <span className="ai-caret" aria-hidden="true" />}</div>
        </>
      )}
      {error && <div className="ai-error" role="alert">{error}</div>}

      {working && (
        <div className="ai-card-actions">
          <button className="btn" onClick={() => abort.current?.abort()}>Stop</button>
        </div>
      )}

      {phase === 'done' && answer && (
        <>
          <div className="ai-card-actions">
            {edit ? (
              <>
                <button className="btn primary" onClick={() => finish(applyToEditor(target, answer, where))}>{labelOf(where)}</button>
                <button className="btn" onClick={() => finish(applyToEditor(target, answer, other))}>{labelOf(other)}</button>
              </>
            ) : (
              <button className="btn primary" onClick={() => finish(insertWritten(target, answer))}>Insert</button>
            )}
            {hasTasks && <button className="btn" onClick={() => finish(insertAsChecklist(target, answer))}>Insert as checklist</button>}
            {(!edit || !target.editor || target.editor.isDestroyed) && edit && <button className="btn" onClick={() => finish(insertAsBox(target, answer))}>Insert as a new box</button>}
            <button className="btn" onClick={again}>Try again</button>
            <button className="btn" onClick={closeInlineAi}>Discard</button>
          </div>
          <input
            ref={input}
            className="field ai-ask"
            aria-label="Tell AI what to do next"
            placeholder="Tell AI what to do next…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (e.preventDefault(), refine())}
          />
        </>
      )}

      {pending && (
        <ConfirmShare
          pending={pending.pending}
          to={info.label}
          system={edit ? EDIT_SYSTEM : WRITE_SYSTEM}
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
