import { useEffect, useMemo, useRef } from 'react';
import { createPageFromTemplate, useNotes } from '../../store/notes';
import { closeTemplatePicker, usePicker } from '../../store/picker';
import { navigate } from '../../lib/route';
import { templatesOf } from '../../lib/pages';
import { Icon } from '../ui/Icon';
import { Thumbnail } from './Thumbnail';

/** "New page": a grid of Blank and every template, each with a live picture of its contents. */
export function TemplatePicker() {
  const open = usePicker((s) => s.open);
  return open ? <Picker /> : null;
}

function Picker() {
  const pages = useNotes((s) => s.pages);
  const templates = useMemo(() => templatesOf(pages), [pages]);
  const blankRef = useRef<HTMLButtonElement>(null);
  const prevFocus = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    blankRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  function close() {
    closeTemplatePicker();
    (prevFocus.current as HTMLElement | null)?.focus?.();
  }
  function choose(templateId: string | null) {
    const page = createPageFromTemplate(templateId);
    closeTemplatePicker();
    if (page) navigate({ name: 'page', id: page.id });
  }

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog picker" role="dialog" aria-modal="true" aria-label="New page">
        <h2>New page</h2>
        <p>Start from a blank page, or from a template. A page made from a template is its own copy.</p>
        <div className="tpl-grid">
          <button ref={blankRef} className="tpl" onClick={() => choose(null)}>
            <span className="tpl-blank">
              <Icon name="plus" size={26} />
            </span>
            <span className="tpl-name">Blank</span>
          </button>
          {templates.map((t) => (
            <button key={t.id} className="tpl" onClick={() => choose(t.id)} aria-label={`New page from ${t.title || 'Untitled'}`}>
              <Thumbnail blocks={t.blocks} arrows={t.arrows} drawing={t.drawing} />
              <span className="tpl-name">{t.title || 'Untitled'}</span>
            </button>
          ))}
        </div>
        {!templates.length && <p className="tpl-hint">Save any page as a template, from its card menu or the editor, and it will show up here.</p>}
        <div className="row">
          <button className="btn" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
