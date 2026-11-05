import { memo, useRef, useState } from 'react';
import { Group, NoteColor, Page } from '../../types';
import { cleanColor, noteVar } from '../../lib/colors';
import { colorVar, timeAgo } from '../../lib/util';
import { navigate } from '../../lib/route';
import { createGroup, deletePage, duplicatePage, mutatePage, saveAsTemplate, setPageColor, setPageGroup, useNotes } from '../../store/notes';
import { ask, openMenu, toast } from '../../store/ui';
import { Icon } from '../ui/Icon';
import { EXPORT_ITEMS } from '../../export/export';
import { groupChoices } from './shared';
import { pinPage } from '../../widgets';
import { widgetsAvailableNow } from '../../widgets/host';
import { Thumbnail } from './Thumbnail';
import { COARSE, PAGE_MIME } from './shared';

/* ---------------- Card ---------------- */

export const PageCard = memo(function PageCard({ page, group }: { page: Page; group: Group | null }) {
  const menuRef = useRef<HTMLButtonElement>(null);
  const groups = useNotes((s) => s.groups);
  const [dragging, setDragging] = useState(false);
  const pressMenuShown = useRef(false);
  const cancelPress = useRef<(() => void) | null>(null);
  const open = () => {
    if (pressMenuShown.current) {
      pressMenuShown.current = false;
      return;
    }
    navigate({ name: 'page', id: page.id });
  };

  const cardColor = cleanColor(page.color);

  const showMenu = () => {
    if (!menuRef.current) return;
    openMenu(menuRef.current, [
      { label: 'Open', action: open },
      {
        label: 'Rename…',
        action: async () => {
          const v = await ask({ title: 'Rename page', initial: page.title, okLabel: 'Rename', placeholder: 'Untitled' });
          if (v !== null) {
            mutatePage(page.id, (p) => {
              p.title = v.trim();
            }, { history: 'none' });
          }
        },
      },
      { label: 'Duplicate', action: () => duplicatePage(page.id) },
      ...(widgetsAvailableNow() ? [{ label: 'Pin to desktop', action: () => void pinPage(page) }] : []),
      {
        label: 'Save as template…',
        action: async () => {
          const name = await ask({ title: 'Save as template', initial: page.title, okLabel: 'Save template', placeholder: 'Template name', text: 'Keeps this page’s layout and boxes. New pages made from it are independent copies.' });
          if (name !== null && saveAsTemplate(page.id, name)) toast(`Saved template “${name.trim() || page.title || 'Untitled template'}”`);
        },
      },
      { colors: true, title: 'Card color', current: page.color ?? null, pick: (c: NoteColor | null) => setPageColor(page.id, c) },
      { separator: true },
      { heading: 'Export as' },
      ...EXPORT_ITEMS(page.id),
      { separator: true },
      { heading: 'Move to group' },
      { label: 'Ungrouped', check: !group, action: () => setPageGroup(page.id, null) },
      ...groupChoices(groups, group?.id ?? null, (id) => setPageGroup(page.id, id)),
      {
        label: 'New group…',
        action: async () => {
          const v = await ask({ title: 'New group', okLabel: 'Create group', placeholder: 'Group name' });
          if (v?.trim()) setPageGroup(page.id, createGroup(v).id);
        },
      },
      { separator: true },
      { label: 'Delete page', danger: true, action: () => void deletePage(page.id) },
    ]);
  };

  return (
    <article
      className={'card' + (group ? ' grouped' : '') + (cardColor ? ' colored' : '') + (dragging ? ' dragging' : '')}
      style={{ ...(group ? { '--gc': colorVar(group.color) } : {}), ...(cardColor ? { '--pc': noteVar(cardColor) } : {}) } as React.CSSProperties}
      tabIndex={0}
      draggable={!COARSE}
      aria-label={`Open ${page.title || 'Untitled'}`}
      onClick={open}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch') return;
        // Long-press on a phone opens the card's menu.
        cancelPress.current?.();
        pressMenuShown.current = false;
        const x0 = e.clientX, y0 = e.clientY;
        const timer = window.setTimeout(() => {
          cancelPress.current?.();
          pressMenuShown.current = true;
          navigator.vibrate?.(12);
          showMenu();
        }, 450);
        const onMove = (ev: PointerEvent) => {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) cancelPress.current?.();
        };
        const stop = () => cancelPress.current?.();
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
        cancelPress.current = () => {
          clearTimeout(timer);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', stop);
          window.removeEventListener('pointercancel', stop);
          cancelPress.current = null;
        };
      }}
      onContextMenu={(e) => {
        // Right-click on a laptop. On phones the long-press above already opened it.
        e.preventDefault();
        if (!pressMenuShown.current) showMenu();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) open();
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(PAGE_MIME, page.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      {group && <div className="tab">{group.name}</div>}
      <Thumbnail blocks={page.blocks} arrows={page.arrows} drawing={page.drawing} sheet={page.sheet} />
      <button
        ref={menuRef}
        className="icon-btn card-menu"
        aria-label={`Options for ${page.title || 'Untitled'}`}
        onClick={(e) => {
          e.stopPropagation();
          showMenu();
        }}
      >
        <Icon name="more" />
      </button>
      <div className="card-body">
        <div className={'card-title' + (page.title ? '' : ' untitled')}>{page.title || 'Untitled'}</div>
        <div className="card-meta">{timeAgo(page.updated)}</div>
      </div>
    </article>
  );
});

