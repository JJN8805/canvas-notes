import { useCallback, useEffect, useRef, useState } from 'react';
import { cardLabel, cardParts } from '../../lib/cards';
import { useImageUrl } from '../../lib/useImageUrl';
import { useNotes, deletePage } from '../../store/notes';
import { archivePage } from '../../store/archive';
import { Picture } from '../blocks/Picture';
import { featureOn } from '../../store/features';
import { ensureCardBody, removeCardCover, setCardCover, setCardLabel } from '../../store/cards';
import { confirmDanger, toast } from '../../store/ui';
import { Icon } from '../ui/Icon';
import { BlockBody } from '../blocks/BlockBody';
import { CanvasCtx } from '../editor/context';
import { soloCtx } from '../editor/soloCtx';
import { cardPictureSources, useAddons } from '../../addons/store';
import { CardLinks } from './CardLinks';
import { confirmsOnEnter, enterKey } from '../../lib/enterConfirm';
import { CardTags } from './CardTags';
import { FolderOptions } from './FolderSelect';
import { fileCard } from '../../store/cardFolders';
import { folderOfCard } from '../../lib/cardFolders';

/** What opens when a card is clicked: the big picture, the label and the details, all editable here. */
export function CardDetail({ cardId, onClose: onCloseProp }: { cardId: string; onClose: () => void }) {
  // The parent passes a new function each render; keep one stable `onClose` so the effects below run only on opening.
  const closeRef = useRef(onCloseProp);
  closeRef.current = onCloseProp;
  const onClose = useCallback(() => closeRef.current(), []);
  const card = useNotes((s) => s.pages[cardId]);
  const folders = useNotes((s) => s.cardFolders);
  const fileRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const prevFocus = useRef<Element | null>(document.activeElement);
  const { cover, body } = card ? cardParts(card) : { cover: null, body: null };
  const url = useImageUrl(cover?.imageId ?? '');
  const [busy, setBusy] = useState(false);
  useAddons((s) => s.loaded); // re-render when an add-on starts or stops, so its picture buttons appear
  const sources = cardPictureSources();
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const sourceOpen = useRef(false);
  sourceOpen.current = sourceKey !== null;

  useEffect(() => {
    ensureCardBody(cardId);
    const first = card && !card.title.trim() && !cardParts(card).body?.html;
    (first ? labelRef.current : null)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sourceOpen.current) {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing && !sourceOpen.current) {
        // Ctrl+Enter is Done even from the details box, ahead of the text editor (which would make a line break of it).
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const restore = prevFocus.current as HTMLElement | null;
    return () => {
      document.removeEventListener('keydown', onKey, true);
      restore?.focus?.();
    };
    // Only on opening: the card is read once to decide where focus goes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, onClose]);

  // The card was deleted from somewhere else while open.
  useEffect(() => {
    if (!card) onClose();
  }, [card, onClose]);
  if (!card) return null;

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await setCardCover(cardId, file);
    } catch (e) {
      toast(`Couldn’t use that picture: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog card-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`Card: ${cardLabel(card)}`}
        onKeyDown={(e) => {
          // Enter does what Done does: from the label, or Ctrl+Enter from the details. The tag field keeps Enter for adding a tag.
          if (!sourceOpen.current && confirmsOnEnter(enterKey(e))) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className={'cd-cover' + (cover?.video ? ' has-video' : '') + (cover && url ? '' : ' nocover')}>
          {cover && url ? <Picture url={url} video={cover.video} play="controls" /> : <span className="cd-nocover">No picture yet</span>}
          <div className="cd-cover-actions">
            <button className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>
              {cover ? 'Change picture or video' : 'Add picture, GIF or video'}
            </button>
            {sources.map((s) => (
              <button key={s.key} className="btn small" disabled={busy} onClick={() => setSourceKey(s.key)}>
                {s.label}
              </button>
            ))}
            {cover && (
              <button className="btn small" disabled={busy} onClick={() => removeCardCover(cardId)}>
                Remove
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime,video/ogg,.mp4,.webm,.mov,.m4v,.ogv" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
        </div>
        <input
          ref={labelRef}
          className="cd-label"
          value={card.title}
          maxLength={120}
          placeholder="Card label"
          aria-label="Card label"
          onChange={(e) => setCardLabel(cardId, e.target.value)}
        />
        <div className="cd-meta">
          <CardTags cardId={cardId} />
          <label className="cd-set">
            <span>Folder</span>
            <select className="field" aria-label="Folder or section this card is in" value={folderOfCard(card, folders) ?? ''} onChange={(e) => fileCard(cardId, e.target.value || null)}>
              <option value="">Not in a folder</option>
              <FolderOptions />
            </select>
          </label>
        </div>
        {body && <CardLinks cardId={cardId} bodyId={body.id} />}
        <div className="cd-body">
          {body ? (
            <CanvasCtx.Provider value={soloCtx(cardId)}>
              <div className="block b-text">
                <BlockBody block={body} />
              </div>
            </CanvasCtx.Provider>
          ) : null}
        </div>
        {sources.map((s) => sourceKey === s.key && <s.Dialog key={s.key} cardLabel={card.title} onPick={(f) => void pick(f)} onClose={() => setSourceKey(null)} />)}
        <div className="cd-actions">
          <button
            className="btn"
            onClick={() =>
              void confirmDanger(`Delete “${cardLabel(card)}”?`, 'The card goes to Trash, where you can restore it.', 'Delete card').then((ok) => {
                if (ok) {
                  void deletePage(cardId);
                  onClose();
                }
              })
            }
          >
            <Icon name="trash" size={16} />
            Delete
          </button>
          {featureOn('archive') && (
            <button
              className="btn"
              onClick={() => {
                if (archivePage(cardId)) onClose();
              }}
            >
              <Icon name="archive" size={16} />
              Archive
            </button>
          )}
          <span className="cd-spacer" />
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
