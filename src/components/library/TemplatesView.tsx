import { memo, useMemo, useRef } from 'react';
import { Page } from '../../types';
import { timeAgo } from '../../lib/util';
import { resolveDailyTemplate, templatesOf } from '../../lib/pages';
import { usePrefs } from '../../store/prefs';
import { navigate } from '../../lib/route';
import { chooseDailyTemplate, createPageFromTemplate, createTemplate, deleteTemplate, duplicateTemplate, renameTemplate, useNotes } from '../../store/notes';
import { ask, confirmDanger, openMenu } from '../../store/ui';
import { Icon } from '../ui/Icon';
import { Thumbnail } from './Thumbnail';

/* ---------------- Templates ---------------- */

export function openTemplate(id: string) {
  navigate({ name: 'page', id });
}

export function TemplatesView() {
  const pages = useNotes((s) => s.pages);
  const templates = useMemo(() => templatesOf(pages), [pages]);
  const dailySetting = usePrefs((s) => s.dailyTemplate);
  const dailyId = resolveDailyTemplate(pages, dailySetting)?.id ?? null;
  return (
    <>
      <div className="main-head">
        <div className="main-title">
          <h1>Templates</h1>
          <p>
            {templates.length} template{templates.length === 1 ? '' : 's'}. A page made from one is its own copy, so changing a template never changes pages you already made.
          </p>
        </div>
        <div className="controls">
          <button className="btn primary" onClick={() => openTemplate(createTemplate().id)}>
            <Icon name="plus" size={16} />
            New template
          </button>
        </div>
      </div>
      {templates.length ? (
        <div className="cards">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} isDaily={t.id === dailyId} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>No templates</h2>
          <p>Save any page as a template from its card menu, or make a new one here.</p>
        </div>
      )}
    </>
  );
}

export const TemplateCard = memo(function TemplateCard({ template: t, isDaily }: { template: Page; isDaily: boolean }) {
  const menuRef = useRef<HTMLButtonElement>(null);
  const showMenu = () => {
    if (!menuRef.current) return;
    openMenu(menuRef.current, [
      { label: 'Edit template', action: () => openTemplate(t.id) },
      {
        label: 'New page from this',
        action: () => {
          const p = createPageFromTemplate(t.id);
          if (p) navigate({ name: 'page', id: p.id });
        },
      },
      { separator: true },
      {
        label: 'Rename…',
        action: async () => {
          const v = await ask({ title: 'Rename template', initial: t.title, okLabel: 'Rename', placeholder: 'Template name' });
          if (v !== null) renameTemplate(t.id, v);
        },
      },
      { label: 'Duplicate', action: () => void duplicateTemplate(t.id) },
      { label: 'Use for daily pages', check: isDaily, action: () => chooseDailyTemplate(t.id) },
      { separator: true },
      {
        label: 'Delete template',
        danger: true,
        action: async () => {
          const ok = await confirmDanger(
            `Delete “${t.title || 'Untitled template'}”?`,
            'Pages already made from it are not affected. This removes the template from your other devices the next time they sync, and cannot be undone.',
            'Delete template',
          );
          if (ok) await deleteTemplate(t.id);
        },
      },
    ]);
  };
  return (
    <article
      className="card"
      tabIndex={0}
      aria-label={`Edit template ${t.title || 'Untitled template'}`}
      onClick={() => openTemplate(t.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openTemplate(t.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        showMenu();
      }}
    >
      <Thumbnail blocks={t.blocks} arrows={t.arrows} drawing={t.drawing} />
      <button
        ref={menuRef}
        className="icon-btn card-menu"
        aria-label={`Options for ${t.title || 'Untitled template'}`}
        onClick={(e) => {
          e.stopPropagation();
          showMenu();
        }}
      >
        <Icon name="more" />
      </button>
      <div className="card-body">
        <div className={'card-title' + (t.title ? '' : ' untitled')}>{t.title || 'Untitled template'}</div>
        <div className="card-meta">{isDaily ? 'Used for daily pages' : timeAgo(t.updated)}</div>
      </div>
    </article>
  );
});

