import { useState } from 'react';
import { startFolderEdit, useFolderEdit } from '../../store/cardEdit';
import { FolderEditForm } from './FolderEditForm';
import type { Group, Page } from '../../types';
import { childrenOf, depthOf } from '../../lib/cardFolders';
import { frameInk } from '../../lib/colors';
import { colorVar } from '../../lib/util';
import { Icon } from '../ui/Icon';
import { CardTile } from './CardTile';
import { cardLabel } from '../../lib/cards';
import { openCardMenu, openCardMenuAt } from './cardMenu';
import { FolderPicture } from './FolderPicture';
import { CARD_FOLDER_MIME, CARD_MIME, useFolderDrop } from './cardDnd';

const KEY = 'cards.sections.closed';
const readClosed = (): Set<string> => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
};

/** Which sections are rolled up (kept for next time). */
export function useClosedSections() {
  const [closed, setClosed] = useState<Set<string>>(readClosed);
  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        /* remembering which sections are rolled up is a convenience */
      }
      return next;
    });
  return { closed, toggle };
}

interface Shared {
  folders: Group[];
  /** The cards directly in each folder or section, in the order to show them. */
  byFolder: Map<string | null, Page[]>;
  /** Cards in each folder including its sections. */
  counts: Map<string, number>;
  closed: Set<string>;
  toggle: (id: string) => void;
  onOpenCard: (id: string) => void;
  onFocus: (id: string) => void;
  onAddCard: (folderId: string) => void;
  onMenu: (anchor: HTMLElement, folder: Group) => void;
}

/** The cards of a place, as a grid you can drag from. */
export function CardGrid({ cards, onOpenCard }: { cards: Page[]; onOpenCard: (id: string) => void }) {
  return (
    <div className="cgrid section-cards">
      {cards.map((c) => (
        <div
          key={c.id}
          className="cf-card"
          onContextMenu={(e) => { e.preventDefault(); openCardMenuAt(e.clientX, e.clientY, e.currentTarget, c, () => onOpenCard(c.id)); }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(CARD_MIME, c.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
        >
          <CardTile card={c} onOpen={() => onOpenCard(c.id)} />
          <button className="cf-card-more" aria-label={`Options for ${cardLabel(c)}`} title="Copy, move to another workspace, archive, delete" onClick={(e) => openCardMenu(e.currentTarget, c, () => onOpenCard(c.id))}>
            <Icon name="more" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** The sections of a place, one after another. */
export function SectionList({ parent, level, ...shared }: Shared & { parent: string | null; level: number }) {
  return (
    <>
      {childrenOf(shared.folders, parent).map((f) => (
        <CardSection key={f.id} folder={f} level={level} {...shared} />
      ))}
    </>
  );
}

/**
 * A folder or section laid out like a frame on the canvas: a coloured heading on top, its cards below it, then the sections inside it (each the
 * same, one level in). Drop a card on it to file it there; drag its heading to move the whole section.
 */
function CardSection({ folder, level, ...shared }: Shared & { folder: Group; level: number }) {
  const { byFolder, counts, closed, toggle, onOpenCard, onFocus, onAddCard, onMenu, folders } = shared;
  const drop = useFolderDrop(folder.id, folder.name);
  const editing = useFolderEdit((s) => s.id === folder.id);
  const open = !closed.has(folder.id) || editing; // editing a rolled-up section opens it
  const mine = byFolder.get(folder.id) ?? [];
  const inside = counts.get(folder.id) ?? 0;
  const hasKids = childrenOf(folders, folder.id).length > 0;
  const ink = frameInk(folder.color) ?? '#fff';
  const colour = colorVar(folder.color);
  return (
    <section
      className={`section level-${Math.min(level, 3)}` + (drop.over ? ' drop-ok' : '')}
      style={{ ['--section' as string]: colour }}
      aria-label={`${folder.name}, ${inside} card${inside === 1 ? '' : 's'}`}
      {...drop.props}
    >
      <header
        className="section-head"
        style={{ background: colour, color: ink }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(CARD_FOLDER_MIME, folder.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <button className={'section-twist' + (open ? ' open' : '')} aria-expanded={open} aria-label={`${open ? 'Roll up' : 'Open'} ${folder.name}`} onClick={() => toggle(folder.id)}>
          <Icon name="chevron" size={16} />
        </button>
        <FolderPicture folder={folder} kind="thumb" />
        <button className="section-name" onClick={() => onFocus(folder.id)} title={`Open ${folder.name}`}>
          {folder.name}
        </button>
        <span className="section-count">
          {inside} card{inside === 1 ? '' : 's'}
        </span>
        <button className="section-act" aria-label={`Edit ${folder.name}`} title="Edit name and description" onClick={() => startFolderEdit(folder.id)}>
          <Icon name="edit" size={15} />
        </button>
        <button className="section-act" aria-label={`Add a card to ${folder.name}`} title="Add a card here" onClick={() => onAddCard(folder.id)}>
          <Icon name="plus" size={16} />
        </button>
        <button className="section-act" aria-label={`Menu for ${folder.name}`} onClick={(e) => onMenu(e.currentTarget, folder)}>
          <Icon name="more" size={16} />
        </button>
      </header>
      {open && (
        <div className="section-body">
          <FolderPicture folder={folder} kind="banner" />
          {editing ? (
            <FolderEditForm folder={folder} depth={depthOf(folders, folder.id)} />
          ) : folder.description ? (
            <p className="section-desc" title="Click to edit" onClick={() => startFolderEdit(folder.id)}>
              {folder.description}
            </p>
          ) : (
            <button className="section-adddesc" onClick={() => startFolderEdit(folder.id)}>
              + Add a description
            </button>
          )}
          {mine.length > 0 && <CardGrid cards={mine} onOpenCard={onOpenCard} />}
          {mine.length === 0 && !hasKids && <p className="section-empty">No cards here yet. Drop one on this section, or use + to add one.</p>}
          {hasKids && <SectionList parent={folder.id} level={level + 1} {...shared} />}
        </div>
      )}
    </section>
  );
}
