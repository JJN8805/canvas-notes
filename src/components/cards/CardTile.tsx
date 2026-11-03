import { memo } from 'react';
import type { Page } from '../../types';
import { cardInitial, cardLabel, cardParts } from '../../lib/cards';
import { useImageUrl } from '../../lib/useImageUrl';

/** A card as it looks in the gallery: its cover picture and its label. Click it to open the details. */
export const CardTile = memo(function CardTile({ card, onOpen }: { card: Page; onOpen: () => void }) {
  const { cover } = cardParts(card);
  const url = useImageUrl(cover?.imageId ?? '');
  const label = cardLabel(card);
  return (
    <button className="ctile" onClick={onOpen} aria-label={`Open card ${label}`}>
      <span className="ctile-cover">
        {cover && url ? <img src={url} alt="" draggable={false} /> : <span className="ctile-initial" aria-hidden="true">{cardInitial(card)}</span>}
      </span>
      <span className="ctile-label" title={label}>{label}</span>
    </button>
  );
});
