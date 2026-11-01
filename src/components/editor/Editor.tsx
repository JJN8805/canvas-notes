import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useEditorState, type Editor as TipTapEditor } from '@tiptap/react';
import type { BlockType } from '../../types';
import { navigate } from '../../lib/route';
import { CalendarButton, goToDay } from '../ui/Calendar';
import { addDays, dailyTitle, dateKey } from '../../lib/daily';
import { isTemplate, libraryPages } from '../../lib/pages';
import { STICKY_SIZE } from '../../lib/colors';
import { MOD_LABEL, normTag } from '../../lib/util';
import {
  addBlock,
  createGroup,
  flushPage,
  getStorage,
  history,
  mutatePage,
  redo,
  refreshAttendance,
  rolloverTracked,
  saveAsTemplate,
  setFilter,
  setPageGroup,
  undo,
  useNotes,
} from '../../store/notes';
import { addImages } from '../../store/images';
import { canvasApi, resetCanvas, setSelectMode, setSelected, useCanvas } from '../../store/canvas';
import { ask, openMenu, toast } from '../../store/ui';
import { EXPORT_ITEMS } from '../../export/export';
import { groupTree } from '../../lib/groups';
import { Icon } from '../ui/Icon';
import { Canvas } from './Canvas';
import { HistoryPanel } from './HistoryPanel';
import { openNav } from '../../store/nav';
import { DrawOverlay } from './DrawOverlay';
import { closeDraw, toggleDraw, useDraw } from '../../store/draw';

export function Editor({ pageId }: { pageId: string }) {
  const exists = useNotes((s) => !!s.pages[pageId]);
  const template = useNotes((s) => isTemplate(s.pages[pageId] ?? {}));

  useEffect(() => {
    resetCanvas();
    return () => {
      void flushPage(pageId);
      closeDraw();
      resetCanvas();
    };
  }, [pageId]);

  useEffect(() => {
    if (!exists) navigate({ name: 'library' });
  }, [exists]);

  // Start a new day for tracked checklists, and keep an attendance page current, while this page is open
  // (on opening, when the window comes back, and each minute so a page left open past midnight rolls over).
  useEffect(() => {
    const tick = () => {
      rolloverTracked(pageId);
      void refreshAttendance(pageId);
    };
    tick();
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [pageId]);

  if (!exists) return null;
  return (
    <div className="editor">
      <EditorHeader pageId={pageId} />
      {template && <TemplateBanner />}
      <DailyBar pageId={pageId} />
      <div className="ed-body">
        <Canvas pageId={pageId} />
        <DrawOverlay pageId={pageId} />
        <AddToolbar pageId={pageId} />
        <FormatBar />
        <ZoomControls />
      </div>
    </div>
  );
}

/** On a daily page: the previous and next day, the date's calendar, and a way back to today. */
function DailyBar({ pageId }: { pageId: string }) {
  const date = useNotes((s) => {
    const p = s.pages[pageId];
    return p && !isTemplate(p) ? p.dailyDate ?? null : null;
  });
  if (!date) return null;
  return (
    <div className="daily-bar" role="navigation" aria-label="Daily page">
      <button className="icon-btn" aria-label="Previous day" title="Previous day" onClick={() => goToDay(addDays(date, -1))}>
        <Icon name="back" />
      </button>
      <CalendarButton selected={date} label={dailyTitle(date)} align="left" />
      <button className="icon-btn" aria-label="Next day" title="Next day" onClick={() => goToDay(addDays(date, 1))}>
        <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><Icon name="back" /></span>
      </button>
      {date !== dateKey() && (
        <button className="btn" onClick={() => goToDay(dateKey())}>
          Today
        </button>
      )}
    </div>
  );
}

/** Shown while a template is open, so it can't be mistaken for a page. */
function TemplateBanner() {
  return (
    <div className="tpl-banner" role="status">
      <strong>Editing template</strong>
      <span>Changes only affect new pages made from it. Pages you already made are not changed.</span>
      <button
        className="btn"
        onClick={() => {
          setFilter({ kind: 'templates' });
          navigate({ name: 'library' });
        }}
      >
        Done
      </button>
    </div>
  );
}

/* ---------------- Header ---------------- */

/** Pages that mention this one as [[its title]]. Hidden when there are none (or the graph is unavailable). */
function Backlinks({ pageId }: { pageId: string }) {
  const title = useNotes((s) => s.pages[pageId]?.title);
  const updated = useNotes((s) => s.pages[pageId]?.updated);
  const titles = useNotes((s) => s.pages);
  const [links, setLinks] = useState<{ pageId: string; title: string }[]>([]);
  useEffect(() => {
    const graph = getStorage().graph;
    if (!graph) return;
    let live = true;
    // Saves reach the graph a moment after the store changes.
    const t = setTimeout(() => {
      void graph.idle().then(() => graph.backlinks(pageId)).then((l) => live && setLinks(l.filter((b) => titles[b.pageId])));
    }, 800);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // titles changes on every edit of any page, which is when backlinks may change
  }, [pageId, title, updated, titles]);
  if (!links.length) return null;
  return (
    <button
      className="btn ed-backlinks"
      onClick={(e) =>
        openMenu(e.currentTarget, [
          { heading: 'Linked from' },
          ...links.map((l) => ({ label: titles[l.pageId]?.title || 'Untitled', action: () => navigate({ name: 'page', id: l.pageId }) })),
        ])
      }
    >
      Linked from {links.length}
    </button>
  );
}

function EditorHeader({ pageId }: { pageId: string }) {
  const title = useNotes((s) => s.pages[pageId]?.title ?? '');
  const groupId = useNotes((s) => s.pages[pageId]?.groupId ?? null);
  const blockCount = useNotes((s) => s.pages[pageId]?.blocks.length ?? 0);
  const groups = useNotes((s) => s.groups);
  const template = useNotes((s) => isTemplate(s.pages[pageId] ?? {}));
  useNotes((s) => s.historyVersion); // re-render when undo/redo availability changes
  const canUndo = history.canUndo(pageId);
  const canRedo = history.canRedo(pageId);
  const titleRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!title && !blockCount) titleRef.current?.focus();
    // only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <header className="ed-head">
      <button
        className="btn ed-back"
        onClick={() => {
          if (template) setFilter({ kind: 'templates' });
          navigate({ name: 'library' });
        }}
      >
        <Icon name="back" />
        {template ? 'Templates' : 'Library'}
      </button>
      <input
        ref={titleRef}
        className="ed-title"
        value={title}
        placeholder={template ? 'Untitled template' : 'Untitled'}
        aria-label={template ? 'Template name' : 'Page title'}
        maxLength={120}
        onChange={(e) =>
          mutatePage(pageId, (p) => {
            p.title = e.target.value;
          }, { history: 'none' })
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <div className="ed-actions">
        <button className="icon-btn" aria-label="Undo" title={`Undo (${MOD_LABEL}+Z)`} disabled={!canUndo} onClick={() => undo(pageId)}>
          <Icon name="undo" />
        </button>
        <button className="icon-btn" aria-label="Redo" title={`Redo (${MOD_LABEL}+Shift+Z)`} disabled={!canRedo} onClick={() => redo(pageId)}>
          <Icon name="redo" />
        </button>
      </div>
      {!template && (
        <>
      <select
        className="field ed-group"
        aria-label="Group"
        value={groupId && groups.some((g) => g.id === groupId) ? groupId : ''}
        onChange={async (e) => {
          if (e.target.value === '__new') {
            const v = await ask({ title: 'New group', okLabel: 'Create group', placeholder: 'Group name' });
            if (v?.trim()) setPageGroup(pageId, createGroup(v).id);
            return;
          }
          setPageGroup(pageId, e.target.value || null);
        }}
      >
        <option value="">No group</option>
        {groupTree(groups).map(({ group: g, depth }) => (
          <option key={g.id} value={g.id}>
            {'\u00a0\u00a0\u00a0'.repeat(depth) + g.name}
          </option>
        ))}
        <option value="__new">New group…</option>
      </select>
      <TagEditor pageId={pageId} />
      <Backlinks pageId={pageId} />
      <button
        className="btn ed-template"
        title="Keep this page's layout and boxes as a template for new pages"
        onClick={async () => {
          const name = await ask({ title: 'Save as template', initial: title, okLabel: 'Save template', placeholder: 'Template name', text: 'New pages made from it are independent copies.' });
          if (name !== null && saveAsTemplate(pageId, name)) toast(`Saved template “${name.trim() || title || 'Untitled template'}”`);
        }}
      >
        Save as template
      </button>
        </>
      )}
      <button className="btn ed-outline" title="Headings, frames and links of this page" onClick={() => openNav('outline')}>
        Outline
      </button>
      <button className="btn ed-history" onClick={() => setShowHistory(true)}>
        History
      </button>
      {showHistory && <HistoryPanel pageId={pageId} onClose={() => setShowHistory(false)} />}
      {!template && (
      <button
        className="btn ed-export"
        onClick={(e) => openMenu(e.currentTarget, [{ heading: 'Export this page as' }, ...EXPORT_ITEMS(pageId)])}
      >
        Export
      </button>
      )}
      <SaveStatus />
    </header>
  );
}

function SaveStatus() {
  const save = useNotes((s) => s.save);
  const kind = useNotes((s) => s.storageKind);
  const text =
    save.state === 'saving' ? 'Saving…' : save.state === 'saved' ? (kind === 'desktop' ? 'Saved' : 'Saved in browser') : save.state === 'error' ? save.message : '';
  return (
    <span className={'status' + (save.state === 'error' ? ' error' : '')} aria-live="polite" title={save.message}>
      {text}
    </span>
  );
}

function TagEditor({ pageId }: { pageId: string }) {
  const tags = useNotes((s) => s.pages[pageId]?.tags ?? []);
  const pages = useNotes((s) => s.pages);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const known = useMemo(() => {
    const all = new Set<string>();
    for (const p of libraryPages(pages)) p.tags.forEach((t) => all.add(t));
    return [...all].sort();
  }, [pages]);

  const setTags = (next: string[]) =>
    mutatePage(pageId, (p) => {
      p.tags = next;
    }, { history: 'none' });

  const add = () => {
    const t = normTag(draft);
    setDraft('');
    if (t && !tags.includes(t)) setTags([...tags, t]);
  };

  return (
    <div className="tags-ed" onClick={() => inputRef.current?.focus()}>
      {tags.map((t) => (
        <span key={t} className="chip">
          #{t}
          <button className="chip-x" aria-label={`Remove tag ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="tag-input"
        list="known-tags"
        placeholder={tags.length ? 'Add tag' : 'Add tags'}
        aria-label="Add a tag"
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          // Picking a suggestion from the datalist arrives as a full value.
          if (known.includes(v) && !(e.nativeEvent as InputEvent).inputType) {
            setDraft('');
            if (!tags.includes(v)) setTags([...tags, v]);
          } else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            setTags(tags.slice(0, -1));
          }
        }}
        onBlur={add}
      />
      <datalist id="known-tags">
        {known.filter((t) => !tags.includes(t)).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}

/* ---------------- Toolbars ---------------- */

const TOOLS: { type: BlockType; label: string }[] = [
  { type: 'text', label: 'Text' },
  { type: 'sticky', label: 'Sticky' },
  { type: 'image', label: 'Image' },
  { type: 'checklist', label: 'List' },
  { type: 'code', label: 'Code' },
  { type: 'table', label: 'Table' },
  { type: 'frame', label: 'Frame' },
];

function AddToolbar({ pageId }: { pageId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const add = (type: BlockType) => {
    const api = canvasApi.current;
    if (!api) return;
    if (type === 'image') {
      fileRef.current?.click();
      return;
    }
    const spot = type === 'frame' ? api.visibleSpot(360, 240) : type === 'sticky' ? api.visibleSpot(STICKY_SIZE, STICKY_SIZE) : api.visibleSpot(type === 'code' ? 432 : 300, 80);
    let id = '';
    flushSync(() => {
      id = addBlock(pageId, type, spot);
      setSelected([id]);
    });
    if (type !== 'frame') api.focusBlock(id);
  };
  const selectMode = useCanvas((s) => s.selectMode);
  const drawing = useDraw((s) => s.open);
  return (
    <div className="tools" role="toolbar" aria-label="Add to page">
      <button
        className={'tool touch-only' + (selectMode ? ' on' : '')}
        aria-pressed={selectMode}
        title="Select several boxes"
        onClick={() => setSelectMode(!selectMode)}
      >
        <Icon name="select" />
        Select
      </button>
      {TOOLS.map((t) => (
        <button key={t.type} className="tool" title={`Add ${t.label.toLowerCase()}${t.type === 'sticky' ? ' (S)' : ''}`} onClick={() => add(t.type)}>
          <Icon name={t.type} />
          {t.label}
        </button>
      ))}
      <button
        className={'tool' + (drawing ? ' on' : '')}
        aria-pressed={drawing}
        title="Draw on the page, among the boxes"
        onClick={toggleDraw}
      >
        <Icon name="draw" />
        Draw
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="sr"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          const spot = canvasApi.current?.visibleSpot(360, 260) ?? { x: 120, y: 120 };
          void addImages(pageId, files, spot).then((ids) => ids.length && setSelected(ids));
        }}
      />
    </div>
  );
}

function ZoomControls() {
  const zoom = useCanvas((s) => s.zoom);
  return (
    <div className="zoom">
      <button className="icon-btn" aria-label="Zoom out" onClick={() => canvasApi.current?.zoomTo(zoom / 1.2)}>
        <Icon name="minus" size={16} />
      </button>
      <button className="val" title="Reset to 100%" onClick={() => canvasApi.current?.zoomTo(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon-btn" aria-label="Zoom in" onClick={() => canvasApi.current?.zoomTo(zoom * 1.2)}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

function FormatBar() {
  const editor = useCanvas((s) => s.activeEditor);
  if (!editor || editor.isDestroyed) return null;
  return <FormatButtons editor={editor} />;
}

function FormatButtons({ editor }: { editor: TipTapEditor }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('code'),
      link: e.isActive('link'),
    }),
  });
  const chain = () => editor.chain().focus();
  const b = (label: string, content: React.ReactNode, active: boolean, run: () => void, style?: React.CSSProperties) => (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={active ? 'on' : ''}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {content}
    </button>
  );
  const editLink = async () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = await ask({ title: prev ? 'Edit link' : 'Add link', initial: prev ?? 'https://', okLabel: 'Apply', text: 'Leave empty to remove the link.' });
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };
  // A sticky's editor only has some of these; buttons for missing ones are left out.
  const has = (name: string) => !!(editor.schema.marks[name] || editor.schema.nodes[name]);
  const sections = [
    [
      has('bold') && b('Bold', 'B', st.bold, () => chain().toggleBold().run()),
      has('italic') && b('Italic', 'I', st.italic, () => chain().toggleItalic().run(), { fontStyle: 'italic' }),
      has('underline') && b('Underline', 'U', st.underline, () => chain().toggleUnderline().run(), { textDecoration: 'underline' }),
      has('strike') && b('Strikethrough', 'S', st.strike, () => chain().toggleStrike().run(), { textDecoration: 'line-through' }),
      has('code') && b('Inline code', '</>', st.code, () => chain().toggleCode().run()),
    ],
    [
      has('heading') && b('Heading', 'H1', st.h1, () => chain().toggleHeading({ level: 1 }).run()),
      has('heading') && b('Subheading', 'H2', st.h2, () => chain().toggleHeading({ level: 2 }).run()),
      has('blockquote') && b('Quote', '❝', st.quote, () => chain().toggleBlockquote().run()),
    ],
    [
      has('bulletList') && b('Bulleted list', '• List', st.bullet, () => chain().toggleBulletList().run()),
      has('orderedList') && b('Numbered list', '1. List', st.ordered, () => chain().toggleOrderedList().run()),
    ],
    [
      has('link') && b('Link', <Icon name="link" size={16} />, st.link, () => void editLink()),
      b('Clear formatting', 'Clear', false, () => chain().unsetAllMarks().clearNodes().run(), { fontWeight: 500 }),
    ],
  ].map((items) => items.filter(Boolean)).filter((items) => items.length);
  return (
    <div className="fmt" role="toolbar" aria-label="Text formatting">
      {sections.map((items, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sep" />}
          {items}
        </Fragment>
      ))}
    </div>
  );
}
