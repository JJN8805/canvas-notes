import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { closeSlash, useSlash } from '../../store/slash';
import { filterSlash } from '../../lib/slashItems';
import { quickAdd } from './actions';
import { deleteBlocks, useNotes } from '../../store/notes';
import { turnNoteInto, type TurnKind } from '../../store/turnInto';
import { Icon, type IconName } from '../ui/Icon';
import { usePrefs } from '../../store/prefs';

const ICONS: Record<string, IconName> = { text: 'text', sticky: 'sticky', checklist: 'checklist', code: 'code', table: 'table', frame: 'frame' };

/** Press "/" on a page: a small menu at the pointer that filters as you type (Notion, Slack, Linear). Enter adds the first match where the pointer is. */
export function SlashMenu({ pageId }: { pageId: string }) {
  const open = useSlash((s) => s.open);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const keymap = usePrefs((s) => s.keymap) as Record<string, string>;
  const mine = open?.pageId === pageId ? open : null;
  const turning = !!mine?.turn;
  const items = useMemo(() => filterSlash(query).filter((i) => !turning || ['text', 'sticky', 'code', 'checklist'].includes(i.type)), [query, turning]);

  useEffect(() => {
    if (!mine) return;
    setQuery('');
    setIndex(0);
    input.current?.focus();
  }, [mine]);
  useEffect(() => setIndex(0), [query]);
  useLayoutEffect(() => {
    if (!mine || !box.current) return setPos(null);
    const r = box.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(mine.screen.x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(mine.screen.y, window.innerHeight - r.height - 8)) });
  }, [mine, items.length]);
  useEffect(() => {
    if (!mine) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && closeSlash();
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [mine]);
  useEffect(() => () => closeSlash(), [pageId]);

  if (!mine) return null;
  const pick = (i: number) => {
    const item = items[i];
    if (!item) return;
    closeSlash();
    if (mine.turn) {
      // "/" typed at the start of a box with words: it changes into the chosen kind and keeps them.
      turnNoteInto(pageId, mine.turn, item.type as TurnKind);
      return mine.focus(mine.turn);
    }
    if (mine.replace) {
      // "/" typed into an empty box: the choice takes its place (the same kind just goes back to typing in it).
      const old = useNotes.getState().pages[pageId]?.blocks.find((b) => b.id === mine.replace);
      const same = old && old.type === 'note' && (old.style === 'sticky' ? 'sticky' : 'text') === item.type;
      if (same) return mine.focus(mine.replace);
      deleteBlocks(pageId, [mine.replace]);
    }
    quickAdd(pageId, item.type, mine.world, mine.focus);
  };
  return (
    <div ref={box} className="slash" role="dialog" aria-label="Insert a box" style={pos ? { left: pos.left, top: pos.top } : { left: mine.screen.x, top: mine.screen.y, opacity: 0 }}>
      <input
        ref={input}
        className="slash-input"
        placeholder={turning ? 'Turn into… type to filter' : 'Add a box… type to filter'}
        aria-label="Filter the boxes you can add"
        aria-controls="slash-list"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          const giveBack = () => {
            // Cancelled in a box that has words: it was only a slash, so put it back and carry on typing there.
            const id = mine.turn;
            closeSlash();
            if (id) {
              mine.focus(id);
              window.setTimeout(() => document.execCommand('insertText', false, '/'), 0);
            }
          };
          if (e.key === 'Escape') {
            e.preventDefault();
            giveBack();
          } else if (e.key === 'Backspace' && !query && mine.turn) {
            e.preventDefault();
            giveBack();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length) setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            pick(index);
          }
        }}
      />
      <div id="slash-list" role="listbox" className="slash-list">
        {items.length === 0 && <p className="slash-none">Nothing matches “{query.trim()}”.</p>}
        {items.map((item, i) => (
          <button key={item.type} role="option" aria-selected={i === index} className={'slash-item' + (i === index ? ' on' : '')} onMouseEnter={() => setIndex(i)} onClick={() => pick(i)}>
            <span className="slash-icon"><Icon name={ICONS[item.type]} size={18} /></span>
            <span className="slash-text">
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </span>
            {keymap[item.type] && <kbd className="slash-key" title="The key that adds it without this menu">{keymap[item.type].toUpperCase()}</kbd>}
          </button>
        ))}
      </div>
    </div>
  );
}
