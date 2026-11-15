import { useMemo, useState } from 'react';
import type { Group } from '../../types';
import { cardLabel, cardTagCounts, searchCards } from '../../lib/cards';
import { cardsAt, childrenOf, depthOf, folderCounts, folderOfCard, placeName, trailOf } from '../../lib/cardFolders';
import { cardsOf } from '../../lib/pages';
import { createCard } from '../../store/cards';
import { legacyCardCount, moveLegacyCards } from '../../store/cardFolders';
import { useNotes } from '../../store/notes';
import { toast } from '../../store/ui';
import { Icon } from '../ui/Icon';
import { CardDetail } from './CardDetail';
import { CardFolderTree } from './CardFolderTree';
import { useFolderDrop } from './cardDnd';
import { toggleCardTree, useLayout } from '../../store/layout';
import { startFolderEdit, stopFolderEdit, useFolderEdit } from '../../store/cardEdit';
import { FolderEditForm } from './FolderEditForm';
import { MOD_LABEL } from '../../lib/util';
import { openCardFolderMenu, promptNewFolder } from './cardFolderMenu';
import { CardGrid, SectionList, useClosedSections } from './CardSections';

type CardSort = 'label' | 'updated' | 'created';
const PLACE_KEY = 'cards.place';

/**
 * The Cards screen: your card folders as a tree on the left, and on the right what is in the one you opened: its sections as tiles and
 * its cards. At the top you see the folders and the cards that are not in any. Search looks through everything inside where you are.
 */
export function CardsView() {
  const pages = useNotes((s) => s.pages);
  const folders = useNotes((s) => s.cardFolders);
  const treeOpen = useLayout((s) => s.cardTree);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<CardSort>('label');
  const [openId, setOpenId] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(PLACE_KEY) || null;
    } catch {
      return null;
    }
  });
  // A folder that was deleted (here or on another device) leaves you at the top.
  const place = placeId && folders.some((f) => f.id === placeId) ? placeId : null;
  const go = (id: string | null) => {
    stopFolderEdit();
    setPlaceId(id);
    setQ('');
    try {
      if (id) sessionStorage.setItem(PLACE_KEY, id);
      else sessionStorage.removeItem(PLACE_KEY);
    } catch {
      /* remembering where you were is a convenience */
    }
  };

  const every = useMemo(() => cardsOf(pages), [pages]);
  const counts = useMemo(() => folderCounts(every, folders), [every, folders]);
  const trail = useMemo(() => (place ? trailOf(folders, place) : []), [folders, place]);
  const depth = place ? depthOf(folders, place) : -1;
  const sections = useMemo(() => childrenOf(folders, place), [folders, place]);
  const here = useMemo(() => cardsAt(every, folders, place ? { kind: 'folder', id: place } : { kind: 'unfiled' }), [every, folders, place]);
  const searching = !!q.trim();
  // Searching looks through everything inside where you are, however deep.
  const pool = useMemo(() => (searching ? (place ? cardsAt(every, folders, { kind: 'folder', id: place }, { nested: true }) : every) : here), [searching, place, every, folders, here]);
  const shown = useMemo(() => {
    const list = [...searchCards(pool, q)];
    if (sort === 'updated') list.sort((a, b) => b.updated - a.updated);
    else if (sort === 'created') list.sort((a, b) => b.created - a.created);
    else list.sort((a, b) => cardLabel(a).localeCompare(cardLabel(b)));
    return list;
  }, [pool, q, sort]);
  const tagCounts = useMemo(() => cardTagCounts(pool), [pool]);
  // The cards of every folder and section, each in the chosen order, for the sections.
  const byFolder = useMemo(() => {
    const m = new Map<string | null, typeof every>();
    for (const c of searchCards(every, '')) {
      const k = folderOfCard(c, folders);
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    for (const list of m.values()) {
      if (sort === 'updated') list.sort((a, b) => b.updated - a.updated);
      else if (sort === 'created') list.sort((a, b) => b.created - a.created);
      else list.sort((a, b) => cardLabel(a).localeCompare(cardLabel(b)));
    }
    return m;
  }, [every, folders, sort]);
  const { closed, toggle } = useClosedSections();
  const activeTags = q.toLowerCase().split(/\s+/).filter((w) => w.startsWith('#')).map((w) => w.slice(1));
  const toggleTag = (tag: string) => {
    const words = q.split(/\s+/).filter(Boolean);
    const has = words.some((w) => w.toLowerCase() === `#${tag}`);
    setQ((has ? words.filter((w) => w.toLowerCase() !== `#${tag}`) : [...words, `#${tag}`]).join(' '));
  };

  const legacy = legacyCardCount();
  // Folder and section sizes shown on tiles come from the tree counts (everything inside), not from what is open.
  const placeFolder = place ? folders.find((f) => f.id === place) : null;
  const newKind = place ? 'section' : 'folder';
  const newFolder = async () => {
    const made = await promptNewFolder(folders, place);
    if (made && !place) go(made.id); // a new top-level folder is opened, ready for its first card or section
  };
  const newCard = () => setOpenId(createCard('', place).id);
  const rootDrop = useFolderDrop(null, 'Cards');

  const total = every.length;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const inAll = place ? (counts.get(place) ?? 0) : total;
  const subtitle = searching
    ? `${shown.length} of ${pool.length} cards match “${q.trim()}”${place ? ` in ${placeFolder?.name}` : ''}`
    : [
        sections.length ? plural(sections.length, place ? placeName(depth + 1) : 'folder') : '',
        plural(inAll, 'card'),
        // when some of the cards are in sections below, say how many are right here
        here.length !== inAll ? `${here.length} ${place ? 'directly here' : 'not in a folder'}` : '',
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <div className={'cf' + (treeOpen ? '' : ' tree-closed')}>
      {treeOpen && (
      <CardFolderTree
        folders={folders}
        counts={counts}
        total={total}
        place={place}
        onPlace={go}
        onNewFolder={() => void promptNewFolder(folders, null).then((m) => m && go(m.id))}
        // from the tree, the folder is opened first so its details are what you edit
        onMenu={(anchor, f) => openCardFolderMenu(anchor, f, folders, counts.get(f.id) ?? 0, (x) => (go(x.id), startFolderEdit(x.id)))}
      />
      )}
      <section className="cf-main" aria-label={placeFolder ? placeFolder.name : 'All cards'}>
        <nav className="crumbs cf-crumbs" aria-label="Where you are">
          {!treeOpen && (
            <button className="icon-btn cf-show" onClick={toggleCardTree} aria-label="Show folders" title={`Show folders (${MOD_LABEL}+Shift+\\)`}>
              <Icon name="sidebar" size={16} />
            </button>
          )}
          <button className={rootDrop.over ? 'drop-ok' : ''} onClick={() => go(null)} {...rootDrop.props}>
            Cards
          </button>
          {trail.map((f, i) => (
            <span key={f.id}>
              {' / '}
              <button onClick={() => go(f.id)} aria-current={i === trail.length - 1 ? 'page' : undefined}>
                {f.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="main-head">
          <div className="main-title">
            <h1>{placeFolder ? placeFolder.name : 'Cards'}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="controls">
            <label className="search-wrap">
              <Icon name="search" size={16} />
              <input className="field search" type="search" placeholder={place ? `Search in ${placeFolder?.name}` : 'Search cards'} aria-label="Search cards" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <select className="field" aria-label="Sort cards" value={sort} onChange={(e) => setSort(e.target.value as CardSort)}>
              <option value="label">Label A–Z</option>
              <option value="updated">Last edited</option>
              <option value="created">Newest</option>
            </select>
            <button className="btn" onClick={() => void newFolder()}>
              <Icon name="folder" size={16} />
              New {newKind}
            </button>
            <button className="btn primary" onClick={newCard}>
              <Icon name="plus" size={16} />
              New card
            </button>
          </div>
        </div>

        {place && placeFolder && !searching && <PlaceDetails folder={placeFolder} depth={depth} />}

        {legacy > 0 && !searching && (
          <div className="cf-legacy" role="status">
            <span>
              {legacy} card{legacy === 1 ? ' is' : 's are'} still filed under page groups from before card folders. They show here as not in a folder.
            </span>
            <button
              className="btn"
              onClick={() => {
                const r = moveLegacyCards();
                toast(`Made ${r.folders} folder${r.folders === 1 ? '' : 's'} and section${r.folders === 1 ? '' : 's'} and filed ${r.cards} card${r.cards === 1 ? '' : 's'} in ${r.folders === 1 ? 'it' : 'them'}. Your page groups are unchanged.`);
              }}
            >
              Bring them into card folders
            </button>
          </div>
        )}

        {tagCounts.length > 0 && (
          <div className="tagbar" role="group" aria-label="Filter cards by tag">
            {tagCounts.map(({ tag, count }) => (
              <button key={tag} className={`chip tagbtn${activeTags.includes(tag) ? ' on' : ''}`} aria-pressed={activeTags.includes(tag)} onClick={() => toggleTag(tag)}>
                #{tag} <span className="cnt">{count}</span>
              </button>
            ))}
          </div>
        )}

        {!searching && (
          <>
            {here.length > 0 && (
              <>
                {sections.length > 0 && <h2 className="cf-heading">{place ? 'Cards here' : 'Not in a folder'}</h2>}
                <CardGrid cards={byFolder.get(place) ?? []} onOpenCard={setOpenId} />
              </>
            )}
            {sections.length > 0 && (
              <>
                {here.length > 0 && <h2 className="cf-heading">{place ? 'Sections' : 'Folders'}</h2>}
                <div className="sections">
                  <SectionList
                    parent={place}
                    level={0}
                    folders={folders}
                    byFolder={byFolder}
                    counts={counts}
                    closed={closed}
                    toggle={toggle}
                    onOpenCard={setOpenId}
                    onFocus={go}
                    onAddCard={(id) => setOpenId(createCard('', id).id)}
                    onMenu={(anchor, f) => openCardFolderMenu(anchor, f, folders, counts.get(f.id) ?? 0, (x) => startFolderEdit(x.id))}
                  />
                </div>
              </>
            )}
          </>
        )}

        {searching && shown.length > 0 ? (
          <CardGrid cards={shown} onOpenCard={setOpenId} />
        ) : searching ? (
          <div className="empty">
            <h2>No cards match your search</h2>
            <p>Try a different word, or clear the search.</p>
            <div className="row">
              <button className="btn" onClick={() => setQ('')}>Clear search</button>
            </div>
          </div>
        ) : sections.length === 0 && here.length === 0 ? (
          <div className="empty">
            <h2>{place ? `This ${placeName(depth)} is empty` : 'No cards yet'}</h2>
            <p>{place ? `Add a card, or make a section to sort cards into. You can drag cards here from other folders.` : 'Make a folder to keep cards in, then add cards to it. A card has a picture and a label; click it to open the details behind it.'}</p>
            <div className="row">
              <button className="btn primary" onClick={newCard}><Icon name="plus" size={16} />New card</button>
              <button className="btn" onClick={() => void newFolder()}><Icon name="folder" size={16} />New {newKind}</button>
            </div>
          </div>
        ) : null}
      </section>
      {openId && <CardDetail cardId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** The description of the section you have opened (or its edit form), shown under the title. */
function PlaceDetails({ folder, depth }: { folder: Group; depth: number }) {
  const editing = useFolderEdit((s) => s.id === folder.id);
  if (editing) return <FolderEditForm folder={folder} depth={depth} />;
  return folder.description ? (
    <p className="cf-desc" title="Click to edit" onClick={() => startFolderEdit(folder.id)}>
      {folder.description}
    </p>
  ) : (
    <button className="section-adddesc cf-adddesc" onClick={() => startFolderEdit(folder.id)}>
      + Add a description
    </button>
  );
}
