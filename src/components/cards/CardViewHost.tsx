import { closeCard, useCardView } from '../../store/cardView';
import { CardDetail } from './CardDetail';

/** Opens a card's details over whatever is on screen, for a card box on a page. (The Cards gallery opens its own.) */
export function CardViewHost() {
  const id = useCardView((s) => s.id);
  return id ? <CardDetail cardId={id} onClose={closeCard} /> : null;
}
