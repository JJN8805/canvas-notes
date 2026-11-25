import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { scriptBlock } from '../../lib/office/app';
import { cycleType, detectType, moveScene, nextAfter, renameCharacter, setSynopsis, suggest } from '../../lib/script/edit';
import { parseScript, serializeScript, setMeta } from '../../lib/script/fountain';
import { pageOfElements } from '../../lib/script/layout';
import { elementLabel, FORMATS, SCRIPT_FORMAT_IDS, type ElType, type ScriptDoc, type ScriptEl, type ScriptFormat } from '../../lib/script/model';
import { scriptStats } from '../../lib/script/stats';
import { structureById, structureEls } from '../../lib/script/structures';
import { useNotes } from '../../store/notes';
import { setScriptFormat, writeScript } from '../../store/script';
import { toast } from '../../store/ui';
import { Icon, type IconName } from '../ui/Icon';
import { ScriptNav, type NavTab } from './ScriptNav';
import { ScriptRow, type Row } from './ScriptRow';

const TYPE_ICON: Record<ElType, IconName> = {
  scene: 'frame',
  action: 'edit',
  character: 'user',
  dialogue: 'chat',
  parenthetical: 'quote',
  transition: 'swap',
  centered: 'text',
  section: 'outline',
  synopsis: 'sticky',
  pagebreak: 'insert',
};

let counter = 0;
const rowOf = (e: ScriptEl): Row => ({ ...e, id: ++counter });
const toEls = (rows: Row[]): ScriptEl[] => rows.map(({ id: _id, ...e }) => e);
const fromText = (code: string): { meta: ScriptDoc['meta']; rows: Row[] } => {
  const d = parseScript(code);
  return { meta: d.meta, rows: (d.els.length ? d.els : [{ type: 'action' as const, text: '' }]).map(rowOf) };
};

interface State {
  meta: ScriptDoc['meta'];
  rows: Row[];
}

/** A script: a sheet of paper laid out for the chosen format, with a scene list, index cards, characters and story structures beside it. */
export function ScriptScreen({ pageId }: { pageId: string }) {
  const block = useNotes((s) => scriptBlock(s.pages[pageId]?.blocks ?? []));
  const code = block?.code ?? '';
  const format: ScriptFormat = block?.script?.format ?? 'screenplay';
  const spec = FORMATS[format];
  const [state, setState] = useState<State>(() => fromText(code));
  const stateRef = useRef(state);
  stateRef.current = state;
  const written = useRef(code);
  const [active, setActive] = useState<number | null>(null);
  const [tab, setTab] = useState<NavTab>('scenes');
  const [navOpen, setNavOpen] = useState(() => !(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches));
  const refs = useRef(new Map<number, HTMLTextAreaElement>());
  const pending = useRef<{ id: number; pos: number | 'end' } | null>(null);

  // A change that did not come from this screen (undo, sync, another window) replaces what is shown.
  useEffect(() => {
    if (code !== written.current) {
      written.current = code;
      setState(fromText(code));
    }
  }, [code]);

  const commit = useCallback(
    (next: State, key = 'script') => {
      stateRef.current = next;
      setState(next);
      const text = serializeScript({ meta: next.meta, els: toEls(next.rows) });
      if (text !== written.current) {
        written.current = text;
        writeScript(pageId, text, key);
      }
    },
    [pageId],
  );

  // Move the caret where the last key press asked (after the new row exists).
  useEffect(() => {
    const want = pending.current;
    if (!want) return;
    const el = refs.current.get(want.id);
    if (!el) return;
    pending.current = null;
    el.focus();
    const at = want.pos === 'end' ? el.value.length : want.pos;
    el.setSelectionRange(at, at);
    el.scrollIntoView({ block: 'nearest' });
  });

  const els = useMemo(() => toEls(state.rows), [state.rows]);
  const deferred = useDeferredValue(els);
  const deferredMeta = useDeferredValue(state.meta);
  const stats = useMemo(() => scriptStats({ meta: deferredMeta, els: deferred }, format), [deferred, deferredMeta, format]);
  const pageOf = useMemo(() => pageOfElements(deferred, format), [deferred, format]);

  const setRows = (rows: Row[], focus?: { id: number; pos: number | 'end' }, key?: string) => {
    if (focus) pending.current = focus;
    commit({ ...stateRef.current, rows: rows.length ? rows : [rowOf({ type: 'action', text: '' })] }, key);
  };
  const patch = (id: number, change: Partial<ScriptEl>, key = 'script') => setRows(stateRef.current.rows.map((r) => (r.id === id ? { ...r, ...change } : r)), undefined, key);

  const onText = (id: number, text: string) => patch(id, { text });
  const setType = (id: number, type: ElType) => {
    const r = stateRef.current.rows.find((x) => x.id === id);
    if (!r) return;
    patch(id, { type, ...(type === 'section' ? { level: r.level ?? 1 } : {}) }, 'script-type');
    pending.current = { id, pos: 'end' };
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>, id: number) => {
    const rows = stateRef.current.rows;
    const i = rows.findIndex((r) => r.id === id);
    const row = rows[i];
    if (!row) return;
    const ta = e.currentTarget;
    const mod = e.ctrlKey || e.metaKey;
    if (e.nativeEvent.isComposing) return;
    if (mod && /^[1-9]$/.test(e.key)) {
      const type = spec.types[Number(e.key) - 1];
      if (type) {
        e.preventDefault();
        setType(id, type);
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = suggest(els, i)[0];
      if (s && !e.shiftKey) return patch(id, { text: s });
      return setType(id, cycleType(row.type, format, e.shiftKey));
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      e.preventDefault();
      const at = ta.selectionStart;
      const before = row.text.slice(0, at);
      const after = row.text.slice(ta.selectionEnd);
      if (!row.text.trim() && row.type !== 'action' && row.type !== 'section') return setType(id, 'action');
      const type = detectType(row.type, before, format);
      const created = rowOf({ type: nextAfter(type, format), text: after });
      const next = [...rows];
      next[i] = { ...row, type, text: before };
      next.splice(i + 1, 0, created);
      return setRows(next, { id: created.id, pos: 0 }, 'script-enter');
    }
    if (e.key === 'Backspace' && !row.text && i > 0 && ta.selectionStart === 0) {
      e.preventDefault();
      const prev = rows[i - 1];
      return setRows(rows.filter((r) => r.id !== id), { id: prev.id, pos: 'end' }, 'script-enter');
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && i > 0 && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      const prev = rows.slice(0, i).reverse().find((r) => r.type !== 'pagebreak');
      if (prev) {
        e.preventDefault();
        pending.current = { id: prev.id, pos: 'end' };
        refs.current.get(prev.id)?.focus();
      }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && ta.selectionStart === ta.value.length) {
      const nxt = rows.slice(i + 1).find((r) => r.type !== 'pagebreak');
      if (nxt) {
        e.preventDefault();
        pending.current = { id: nxt.id, pos: 0 };
        refs.current.get(nxt.id)?.focus();
        refs.current.get(nxt.id)?.setSelectionRange(0, 0);
      }
    }
  };

  const goTo = (elIndex: number) => {
    const r = stateRef.current.rows[elIndex];
    if (!r) return;
    pending.current = { id: r.id, pos: 'end' };
    const el = refs.current.get(r.id);
    el?.focus();
    el?.scrollIntoView({ block: 'center' });
    if (window.matchMedia?.('(max-width: 760px)').matches) setNavOpen(false);
  };
  const moveSceneAt = (elIndex: number, dir: -1 | 1) => {
    const moved = moveScene(els, elIndex, dir);
    if (moved.index === elIndex) return;
    const byKey = stateRef.current.rows;
    // keep each row's identity: reorder the rows the same way
    const order = moveScene(byKey.map((_, k) => ({ type: byKey[k].type, text: String(k) })), elIndex, dir).els.map((x) => Number(x.text));
    commit({ ...stateRef.current, rows: order.map((k) => byKey[k]) }, 'script-move');
  };
  const addStructure = (id: string, pages: number) => {
    const s = structureById(id);
    if (!s) return;
    const added = structureEls(s, pages).map(rowOf);
    const rows = stateRef.current.rows;
    const onlyBlank = rows.length === 1 && !rows[0].text.trim();
    setRows(onlyBlank ? added : [...rows, ...added]);
    toast(`Added “${s.label}” to the end of the script.`);
    setTab('scenes');
  };
  const rename = (from: string, to: string) => {
    const r = renameCharacter(els, from, to);
    if (!r.changed) return;
    commit({ ...stateRef.current, rows: r.els.map((e, k) => ({ ...e, id: stateRef.current.rows[k].id })) });
    toast(`Renamed ${r.changed} ${r.changed === 1 ? 'cue' : 'cues'} to ${to.toUpperCase()}.`);
  };
  const setNote = (sceneIndex: number, text: string) => {
    const rows = stateRef.current.rows;
    const next = setSynopsis(els, sceneIndex, text);
    const had = rows[sceneIndex + 1]?.type === 'synopsis';
    if (had && next.length === rows.length) commit({ ...stateRef.current, rows: rows.map((r, k) => (k === sceneIndex + 1 ? { ...r, text } : r)) }, 'script-note');
    else if (!had && next.length > rows.length) commit({ ...stateRef.current, rows: [...rows.slice(0, sceneIndex + 1), rowOf(next[sceneIndex + 1]), ...rows.slice(sceneIndex + 1)] }, 'script-note');
    else if (had) commit({ ...stateRef.current, rows: rows.filter((_, k) => k !== sceneIndex + 1) }, 'script-note');
  };

  // Show the page number above the first row of each page after the first.
  const marks = useMemo(() => state.rows.map((_, i) => (i > 0 && pageOf[i] && pageOf[i] > (pageOf[i - 1] ?? 1) ? pageOf[i] : null)), [state.rows, pageOf]);
  const activeIndex = state.rows.findIndex((r) => r.id === active);
  const sugg = useMemo(() => (activeIndex >= 0 ? suggest(els, activeIndex) : []), [els, activeIndex]);

  if (!block) return null;
  const current = activeIndex >= 0 ? state.rows[activeIndex].type : null;
  return (
    <div className={`sc-screen${navOpen ? ' nav-open' : ''}`} data-format={format}>
      <div className="sc-bar" role="toolbar" aria-label="Script tools">
        <label className="sc-format">
          <span className="sc-lbl">Layout</span>
          <select className="field small" aria-label="Script layout" value={format} onChange={(e) => setScriptFormat(pageId, e.target.value as ScriptFormat)} title={spec.about}>
            {SCRIPT_FORMAT_IDS.map((f) => (
              <option key={f} value={f}>{FORMATS[f].label}</option>
            ))}
          </select>
        </label>
        <div className="sc-types" role="group" aria-label="Element type">
          {spec.types.map((t, k) => (
            <button key={t} className={`btn small${current === t ? ' on' : ''}`} aria-pressed={current === t} disabled={active === null} aria-label={elementLabel(format, t)} title={`${elementLabel(format, t)}${k < 9 ? `  (Ctrl+${k + 1})` : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => active !== null && setType(active, t)}>
              <span className="sc-ico"><Icon name={TYPE_ICON[t]} size={16} /></span>
              <span className="sc-lbl">{elementLabel(format, t)}</span>
            </button>
          ))}
          <button className="btn small" aria-label="Insert page break" title="Page break" disabled={active === null} onMouseDown={(e) => e.preventDefault()} onClick={() => {
            const rows = stateRef.current.rows;
            const at = rows.findIndex((r) => r.id === active);
            if (at >= 0) setRows([...rows.slice(0, at + 1), rowOf({ type: 'pagebreak', text: '' }), ...rows.slice(at + 1)]);
          }}>
            <span className="sc-ico"><Icon name="insert" size={16} /></span>
            <span className="sc-lbl">Page break</span>
          </button>
        </div>
        <button className="btn small sc-navtoggle" aria-pressed={navOpen} aria-label={navOpen ? 'Hide the scene list' : 'Show the scene list'} title="Scenes, cards, people, plan" onClick={() => setNavOpen((v) => !v)}>
          <Icon name="sidebar" size={16} />
          <span className="sc-lbl">Scenes</span>
        </button>
      </div>
      <div className="sc-body">
        <div className="sc-scroll">
          <div className="sc-paper" style={{ ['--left' as string]: spec.left }}>
            {state.rows.map((r, i) => (
              <ScriptRow
                key={r.id}
                row={r}
                format={format}
                label={elementLabel(format, r.type)}
                suggestions={r.id === active ? sugg : []}
                pageNo={marks[i]}
                active={r.id === active}
                onText={onText}
                onKey={onKey}
                onFocus={setActive}
                onPick={(id, text) => patch(id, { text })}
                onRemove={(id) => setRows(stateRef.current.rows.filter((x) => x.id !== id))}
                setRef={(id, el) => (el ? refs.current.set(id, el) : refs.current.delete(id))}
              />
            ))}
            <div className="sc-end">End of script · {stats.pages} {stats.pages === 1 ? 'page' : 'pages'}</div>
          </div>
        </div>
        {navOpen && (
          <ScriptNav
            tab={tab}
            setTab={setTab}
            format={format}
            stats={stats}
            meta={state.meta}
            onMeta={(k, v) => commit({ ...stateRef.current, meta: setMeta({ meta: stateRef.current.meta, els: [] }, k, v).meta }, `script-meta-${k}`)}
            goTo={goTo}
            moveScene={moveSceneAt}
            setSynopsis={setNote}
            rename={rename}
            addStructure={addStructure}
          />
        )}
      </div>
    </div>
  );
}
