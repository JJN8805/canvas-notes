import { useEffect, useRef, useState } from 'react';
import type { Group } from '../../types';
import { MAX_DESCRIPTION, placeNameCap } from '../../lib/cardFolders';
import { updateCardFolder } from '../../store/cardFolders';
import { stopFolderEdit } from '../../store/cardEdit';
import { removeCardFolderCover } from '../../store/cardFolderCover';
import { chooseFolderPicture } from './chooseFolderPicture';
import { FolderPicture } from './FolderPicture';

/**
 * Edits a folder or section's name and description in place. Enter in the name, or Ctrl+Enter in the description, saves; Esc cancels.
 * A name cannot be left empty (it keeps the old one), and an empty description removes the description.
 */
export function FolderEditForm({ folder, depth }: { folder: Group; depth: number }) {
  const [name, setName] = useState(folder.name);
  const [desc, setDesc] = useState(folder.description ?? '');
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);
  const kind = placeNameCap(depth);
  const save = () => {
    updateCardFolder(folder.id, { name, description: desc });
    stopFolderEdit();
  };
  return (
    <form
      className="fe"
      aria-label={`Edit ${kind.toLowerCase()} ${folder.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          stopFolderEdit();
        }
      }}
      // a click or drag inside the form must not open, roll up or move the section around it
      onPointerDown={(e) => e.stopPropagation()}
    >
      <label className="fe-field">
        <span>{kind} name</span>
        <input ref={nameRef} className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={`${kind} name`} />
      </label>
      <label className="fe-field">
        <span>Description</span>
        <textarea
          className="field"
          rows={3}
          value={desc}
          maxLength={MAX_DESCRIPTION}
          placeholder={`What is this ${kind.toLowerCase()} for? (optional)`}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              save();
            }
          }}
        />
      </label>
      <div className="fe-field">
        <span>Picture</span>
        <div className="fe-pic">
          <FolderPicture folder={folder} kind="thumb" />
          <button type="button" className="btn small" onClick={() => chooseFolderPicture(folder.id)}>{folder.cover ? 'Change picture…' : 'Add a picture…'}</button>
          {folder.cover && <button type="button" className="btn small" onClick={() => removeCardFolderCover(folder.id)}>Remove</button>}
        </div>
      </div>
      <div className="fe-actions">
        <button type="submit" className="btn primary">
          Save
        </button>
        <button type="button" className="btn" onClick={stopFolderEdit}>
          Cancel
        </button>
        <span className="fe-hint">Enter saves the name · Ctrl+Enter saves the description · Esc cancels</span>
      </div>
    </form>
  );
}
