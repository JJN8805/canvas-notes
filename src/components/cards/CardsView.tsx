import { useMemo, useState } from 'react';
import { cardLabel, cardTagCounts, inCardSet, searchCards, type CardSet } from '../../lib/cards';
import { withDescendants } from '../../lib/groups';
import { cardsOf } from '../../lib/pages';
import { createCard } from '../../store/cards';
import { useNotes } from '../../store/notes';
import { Icon } from '../ui/Icon';
import { CardDetail } from './CardDetail';
import { CardBoard } from './CardBoard';
import { CardTile } from './CardTile';
import { GroupOptions } from './SetSelect';

type CardSort = 'label' | 'updated' | 'created';

/** The Cards gallery: each card shows its picture and label; click one to open it. */
export function CardsView() {
  const pages = useNotes((s) => s.pages);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<CardSort>('label');
  const [layout, setLayout] = useState<'gallery' | 'board'>(() => {
    try {
      return localStorage.getItem('cards.layout') === 'board' ? 'board' : 'gallery';
    } catch {
      return 'gallery';
    }
  });
  const pickLayout = (l: 'gallery' | 'board') => {
    setLayout(l);
    try {
      localStorage.setItem('cards.layout', l);
    } catch {
      /* remembering the choice is a convenience */
    }
  };
  const [openId, setOpenId] = useState<string | null>(null);
  // '' = every card, '-' = cards in no set, otherwise a group id (its subgroups' cards are included).
  const [setKey, setSetKey] = useState('');
  const groups = useNotes((s) => s.groups);
  // A set that was deleted (here or on another device) falls back to all cards.
  const activeSet = setKey && setKey !== '-' && !groups.some((g) => g.id === setKey) ? '' : setKey;

  const every = useMemo(() => cardsOf(pages), [pages]);
  const set = useMemo<CardSet>(
    () => (activeSet === '' ? { kind: 'all' } : activeSet === '-' ? { kind: 'none' } : { kind: 'group', ids: withDescendants(groups, activeSet) }),
    [activeSet, groups],
  );
  const all = useMemo(() => every.filter((c) => inCardSet(c, set)), [every, set]);
  const tagCounts = useMemo(() => cardTagCounts(all), [all]);
  const shown = useMemo(() => {
    const list = [...searchCards(all, q)];
    if (sort === 'updated') list.sort((a, b) => b.updated - a.updated);
    else if (sort === 'created') list.sort((a, b) => b.created - a.created);
    else list.sort((a, b) => cardLabel(a).localeCompare(cardLabel(b)));
    return list;
  }, [all, q, sort]);
  const searching = !!q.trim();
  const activeTags = q.toLowerCase().split(/\s+/).filter((w) => w.startsWith('#')).map((w) => w.slice(1));
  const toggleTag = (tag: string) => {
    const words = q.split(/\s+/).filter(Boolean);
    const has = words.some((w) => w.toLowerCase() === `#${tag}`);
    setQ((has ? words.filter((w) => w.toLowerCase() !== `#${tag}`) : [...words, `#${tag}`]).join(' '));
  };

  return (
    <>
      <div className="main-head">
        <div className="main-title">
          <h1>Cards</h1>
          <p>
            {searching ? `${shown.length} of ${all.length} cards match “${q.trim()}”` : `${all.length} card${all.length === 1 ? '' : 's'}. Click one to see its details.`}
          </p>
        </div>
        <div className="controls">
          <label className="search-wrap">
            <Icon name="search" size={16} />
            <input className="field search" type="search" placeholder="Search cards" aria-label="Search cards" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="seg" role="group" aria-label="Layout" style={{ marginBottom: 0 }}>
            <button className={'seg-btn' + (layout === 'gallery' ? ' on' : '')} aria-pressed={layout === 'gallery'} onClick={() => pickLayout('gallery')}>Gallery</button>
            <button className={'seg-btn' + (layout === 'board' ? ' on' : '')} aria-pressed={layout === 'board'} onClick={() => pickLayout('board')}>Board</button>
          </div>
          <select className="field" aria-label="Show set of cards" value={activeSet} onChange={(e) => setSetKey(e.target.value)}>
            <option value="">All sets ({every.length})</option>
            <option value="-">No set</option>
            <GroupOptions />
          </select>
          <select className="field" aria-label="Sort cards" value={sort} onChange={(e) => setSort(e.target.value as CardSort)}>
            <option value="label">Label A–Z</option>
            <option value="updated">Last edited</option>
            <option value="created">Newest</option>
          </select>
          <button className="btn primary" onClick={() => setOpenId(createCard('', activeSet && activeSet !== '-' ? activeSet : null).id)}>
            <Icon name="plus" size={16} />
            New card
          </button>
        </div>
      </div>
      {tagCounts.length > 0 && (
        <div className="tagbar" role="group" aria-label="Filter cards by tag">
          {tagCounts.map(({ tag, count }) => (
            <button key={tag} className={`chip tagbtn${activeTags.includes(tag) ? ' on' : ''}`} aria-pressed={activeTags.includes(tag)} onClick={() => toggleTag(tag)}>
              #{tag} <span className="cnt">{count}</span>
            </button>
          ))}
        </div>
      )}
      {layout === 'board' ? (
        <CardBoard cards={shown} within={activeSet && activeSet !== '-' ? activeSet : null} onOpen={setOpenId} />
      ) : shown.length ? (
        <div className="cgrid">
          {shown.map((c) => (
            <CardTile key={c.id} card={c} onOpen={() => setOpenId(c.id)} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>{searching ? 'No cards match your search' : 'No cards yet'}</h2>
          <p>{searching ? 'Try a different word, or clear the search.' : 'A card has a picture and a label. Click it to open the details behind it.'}</p>
          <div className="row">
            {searching ? (
              <button className="btn" onClick={() => setQ('')}>Clear search</button>
            ) : (
              <button className="btn primary" onClick={() => setOpenId(createCard('', activeSet && activeSet !== '-' ? activeSet : null).id)}><Icon name="plus" size={16} />New card</button>
            )}
          </div>
        </div>
      )}
      {openId && <CardDetail cardId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
