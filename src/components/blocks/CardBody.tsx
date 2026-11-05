import type { CardBlock } from '../../types';
import { isCard } from '../../lib/pages';
import { openCard } from '../../store/cardView';
import { useNotes } from '../../store/notes';
import { CardTile } from '../cards/CardTile';
import { useCanvasCtx } from '../editor/context';

/**
 * A card on a page: its picture and label. Tap it (without dragging) to open the card's details; drag it to move the box.
 * The card is a separate item (see `CardBlock`), so if it has been deleted the box says so and can simply be removed.
 */
export function CardBody({ block }: { block: CardBlock }) {
  const { startMove } = useCanvasCtx();
  const card = useNotes((s) => {
    const p = s.pages[block.cardId];
    return p && isCard(p) ? p : undefined;
  });
  return (
    <div className="body card-body" onPointerDown={(e) => startMove(e, block.id, { onTap: () => card && openCard(card.id) })}>
      {card ? (
        // A real click that is a keyboard press (detail 0) opens it too; mouse taps are handled above so a drag never opens it.
        <CardTile card={card} onOpen={() => {}} onKeyboardOpen={() => openCard(card.id)} />
      ) : (
        <div className="missing card-missing">This card was deleted, or hasn’t arrived on this device yet.</div>
      )}
    </div>
  );
}
