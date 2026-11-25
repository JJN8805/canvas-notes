import { clearPageClipboard, pasteHere, usePageClipboard } from '../../store/pageClipboard';
import { Icon } from '../ui/Icon';

/** Shown while pages or cards are copied or cut: paste them into the workspace that is open now. */
export function PasteBar({ groupId }: { groupId?: string | null }) {
  const clip = usePageClipboard((s) => s.clip);
  if (!clip) return null;
  const n = clip.ids.length;
  return (
    <div className="paste-bar" role="status">
      <Icon name="clipboard" size={16} />
      <span>
        {clip.mode === 'copy' ? 'Copied' : 'Cut'} {n} {clip.noun}{n === 1 ? '' : 's'}
      </span>
      <button className="btn primary" onClick={() => void pasteHere({ groupId })}>Paste here</button>
      <button className="btn" aria-label="Forget what was copied" title="Forget what was copied" onClick={clearPageClipboard}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
