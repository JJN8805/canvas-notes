import { useMemo, useState } from 'react';
import type { Group } from '../../types';
import { childrenOf } from '../../lib/cardFolders';
import { colorVar } from '../../lib/util';
import { Icon } from '../ui/Icon';
import { toggleCardTree } from '../../store/layout';
import { MOD_LABEL } from '../../lib/util';
import { CARD_FOLDER_MIME, useFolderDrop } from './cardDnd';

const KEY = 'cards.tree.closed';
const readClosed = (): Set<string> => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
};

interface Props {
  folders: Group[];
  counts: Map<string, number>;
  total: number;
  /** The folder being looked at; null = the top. */
  place: string | null;
  onPlace: (id: string | null) => void;
  onNewFolder: () => void;
  onMenu: (anchor: HTMLElement, folder: Group) => void;
}

/** The folders and sections as a tree you can open and close. Click one to go there; drop a card or folder on one to put it inside. */
export function CardFolderTree({ folders, counts, total, place, onPlace, onNewFolder, onMenu }: Props) {
  const [closed, setClosed] = useState<Set<string>>(readClosed);
  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        /* remembering which folders are open is a convenience */
      }
      return next;
    });
  const root = useFolderDrop(null, 'Cards');

  return (
    <nav className="cf-tree" aria-label="Card folders">
      <div className="cf-tree-head">
        <span>Folders</span>
        <button className="icon-btn" onClick={toggleCardTree} aria-label="Hide folders" title={`Hide folders (${MOD_LABEL}+Shift+\\)`}>
          <Icon name="sidebar" size={16} />
        </button>
      </div>
      <button className={'cf-row cf-root' + (place === null ? ' on' : '') + (root.over ? ' drop-ok' : '')} onClick={() => onPlace(null)} aria-current={place === null ? 'true' : undefined} {...root.props}>
        <Icon name="card" size={16} />
        <span className="cf-name">All cards</span>
        <span className="cnt">{total}</span>
      </button>
      <div className="cf-list" role="tree">
        <Level folders={folders} parent={null} depth={0} closed={closed} toggle={toggle} counts={counts} place={place} onPlace={onPlace} onMenu={onMenu} />
      </div>
      <button className="btn cf-new" onClick={onNewFolder}>
        <Icon name="plus" size={16} />
        New folder
      </button>
    </nav>
  );
}

function Level({ folders, parent, depth, closed, toggle, counts, place, onPlace, onMenu }: Omit<Props, 'total' | 'onNewFolder'> & { parent: string | null; depth: number; closed: Set<string>; toggle: (id: string) => void }) {
  const kids = useMemo(() => childrenOf(folders, parent), [folders, parent]);
  return (
    <>
      {kids.map((f) => (
        <Node key={f.id} folder={f} folders={folders} depth={depth} closed={closed} toggle={toggle} counts={counts} place={place} onPlace={onPlace} onMenu={onMenu} />
      ))}
    </>
  );
}

function Node({ folder, folders, depth, closed, toggle, counts, place, onPlace, onMenu }: Omit<Props, 'total' | 'onNewFolder'> & { folder: Group; depth: number; closed: Set<string>; toggle: (id: string) => void }) {
  const kids = childrenOf(folders, folder.id);
  const open = !closed.has(folder.id);
  const drop = useFolderDrop(folder.id, folder.name);
  return (
    <div role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={place === folder.id}>
      <div
        className={'cf-row' + (place === folder.id ? ' on' : '') + (drop.over ? ' drop-ok' : '')}
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(CARD_FOLDER_MIME, folder.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        {...drop.props}
      >
        {kids.length ? (
          <button className={'cf-twist' + (open ? ' open' : '')} aria-label={`${open ? 'Close' : 'Open'} ${folder.name}`} onClick={() => toggle(folder.id)}>
            <Icon name="chevron" size={14} />
          </button>
        ) : (
          <span className="cf-twist none" aria-hidden="true" />
        )}
        <button className="cf-go" onClick={() => onPlace(folder.id)} aria-current={place === folder.id ? 'true' : undefined} title={folder.name}>
          <span className="cf-dot" style={{ background: colorVar(folder.color) }} aria-hidden="true" />
          <span className="cf-name">{folder.name}</span>
          <span className="cnt">{counts.get(folder.id) ?? 0}</span>
        </button>
        <button className="cf-more icon-btn" aria-label={`Menu for ${folder.name}`} onClick={(e) => onMenu(e.currentTarget, folder)}>
          <Icon name="more" size={14} />
        </button>
      </div>
      {kids.length > 0 && open && (
        <div role="group">
          <Level folders={folders} parent={folder.id} depth={depth + 1} closed={closed} toggle={toggle} counts={counts} place={place} onPlace={onPlace} onMenu={onMenu} />
        </div>
      )}
    </div>
  );
}
