import { useMemo, useRef, useState } from 'react';
import { cardsOf } from '../../lib/pages';
import { normTag } from '../../lib/util';
import { setCardTags } from '../../store/cards';
import { useNotes } from '../../store/notes';

/** A card's tags: type one and press Enter or comma; suggestions come from the tags other cards already use. */
export function CardTags({ cardId }: { cardId: string }) {
  const tags = useNotes((s) => s.pages[cardId]?.tags ?? []);
  const pages = useNotes((s) => s.pages);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const known = useMemo(() => [...new Set(cardsOf(pages).flatMap((c) => c.tags))].sort(), [pages]);

  const add = () => {
    const t = normTag(draft);
    setDraft('');
    if (t && !tags.includes(t)) setCardTags(cardId, [...tags, t]);
  };

  return (
    <div className="tags-ed cd-tags" onClick={() => inputRef.current?.focus()}>
      {tags.map((t) => (
        <span key={t} className="chip">
          #{t}
          <button className="chip-x" aria-label={`Remove tag ${t}`} onClick={() => setCardTags(cardId, tags.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="tag-input"
        list="card-known-tags"
        placeholder={tags.length ? 'Add tag' : 'Add tags'}
        aria-label="Add a tag to this card"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            setCardTags(cardId, tags.slice(0, -1));
          }
        }}
        onBlur={add}
      />
      <datalist id="card-known-tags">
        {known.filter((t) => !tags.includes(t)).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}
