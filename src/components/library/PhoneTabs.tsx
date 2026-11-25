import { useEffect } from 'react';
import type { Filter, Group, Page } from '../../types';
import { setFilter } from '../../store/notes';
import { openNav } from '../../store/nav';
import { useFeature } from '../../store/features';
import { Icon } from '../ui/Icon';
import { Sidebar } from './Sidebar';
import { openNewPage } from './shared';
import { createCount, openCreateMenu } from './createMenu';
import { tabOf } from '../../lib/phoneView';
import { useSelect } from '../../store/librarySelect';

/**
 * The library on a phone: five tabs at the bottom, where the thumb rests (Pages, Journal, **New** in the middle, Cards, More), and the full
 * sidebar as a sheet that slides up from "More" (search, groups, tags, Studio, templates, trash, settings…). New is a tab, not a floating
 * button, so it is on every screen, never covers a list, and opens the one New menu.
 */
export function PhoneTabs({ pages, groups, filter, more, setMore }: { pages: Page[]; groups: Group[]; filter: Filter; more: boolean; setMore: (open: boolean) => void }) {
  const journalOn = useFeature('journal');
  const cardsOn = useFeature('cards');
  const tab = more ? 'more' : tabOf(filter.kind);
  const selecting = useSelect((s) => s.on);

  useEffect(() => {
    if (!more) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMore(false);
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [more, setMore]);

  const go = (f: Filter) => {
    setMore(false);
    setFilter(f);
  };
  return (
    <>
      {more && (
        <div className="phone-scrim" onPointerDown={(e) => e.target === e.currentTarget && setMore(false)}>
          <div className="phone-sheet" role="dialog" aria-label="All sections" onClick={(e) => (e.target as HTMLElement).closest('button') && setMore(false)}>
            <div className="sheet-grip" aria-hidden="true" />
            <button className="sheet-cmd" onClick={() => openNav('commands')}>
              <Icon name="outline" size={18} />
              <span>Commands</span>
              <small>graph view, tidy, theme, settings…</small>
            </button>
            <Sidebar pages={pages} groups={groups} filter={filter} />
          </div>
        </div>
      )}
      <nav className="phone-tabs" aria-label="Sections">
        <TabButton icon="pages" label="Pages" on={tab === 'pages'} onClick={() => go({ kind: 'all' })} />
        {journalOn && <TabButton icon="book" label="Journal" on={tab === 'journal'} onClick={() => go({ kind: 'journal' })} />}
        <button className="phone-tab phone-new" aria-label="New" aria-haspopup="menu" disabled={selecting} onClick={(e) => (setMore(false), createCount() > 1 ? openCreateMenu(e.currentTarget) : openNewPage())}>
          <span className="phone-new-dot"><Icon name="plus" size={24} /></span>
          <span>New</span>
        </button>
        {cardsOn && <TabButton icon="card" label="Cards" on={tab === 'cards'} onClick={() => go({ kind: 'cards' })} />}
        <TabButton icon="more" label="More" on={tab === 'more'} onClick={() => setMore(!more)} />
      </nav>
    </>
  );
}

function TabButton({ icon, label, on, onClick }: { icon: 'pages' | 'book' | 'card' | 'search' | 'more'; label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={'phone-tab' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined} onClick={onClick}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
    </button>
  );
}
