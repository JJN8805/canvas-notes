import { useMemo, useState } from 'react';
import type { Page } from '../../types';
import { boardColumns } from '../../lib/cards';
import { useNotes } from '../../store/notes';
import { setCardSet } from '../../store/cards';
import { CardTile } from './CardTile';

const CARD_MIME = 'application/x-canvas-card';

/**
 * The cards as columns, one per set. Drag a card to another column to move it there.
 * (Keyboard: open the card and use its Set picker.) `within` is the chosen set, or null for all.
 */
export function CardBoard({ cards, within, onOpen }: { cards: Page[]; within: string | null; onOpen: (id: string) => void }) {
  const groups = useNotes((s) => s.groups);
  const columns = useMemo(() => boardColumns(groups, cards, within), [groups, cards, within]);
  const [over, setOver] = useState<string | null | undefined>(undefined); // undefined = no column highlighted
  const [dragging, setDragging] = useState(false);

  return (
    <div className="kb" role="list" aria-label="Cards by set">
      {columns.map((col) => (
        <section
          key={col.groupId ?? 'none'}
          className={'kb-col' + (over === col.groupId ? ' drop-ok' : '')}
          role="listitem"
          aria-label={`${col.title}, ${col.cards.length} cards`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(CARD_MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOver(col.groupId);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(undefined);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setOver(undefined);
            setDragging(false);
            const id = e.dataTransfer.getData(CARD_MIME);
            const card = cards.find((c) => c.id === id);
            if (!card) return;
            // Already in this column (maybe in a subgroup of it): leave it where it is.
            if (columns.find((c) => c.cards.some((x) => x.id === id)) === col) return;
            setCardSet(id, col.groupId);
          }}
        >
          <header className="kb-head">
            <h2 title={col.title}>{col.title}</h2>
            <span className="cnt">{col.cards.length}</span>
          </header>
          <div className="kb-body">
            {col.cards.map((c) => (
              <div
                key={c.id}
                className="kb-card"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(CARD_MIME, c.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragging(true);
                }}
                onDragEnd={() => {
                  setDragging(false);
                  setOver(undefined);
                }}
              >
                <CardTile card={c} onOpen={() => onOpen(c.id)} />
              </div>
            ))}
            {!col.cards.length && <p className="kb-empty">{dragging ? 'Drop here' : 'No cards'}</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
