import type { AudioBlock } from '../../types';
import { formatDuration } from '../../lib/media';
import { useImageUrl } from '../../lib/useImageUrl';
import { useCanvasCtx } from '../editor/context';
import { Icon } from '../ui/Icon';

/** An audio clip: its name above the webview's own player. Drag the box by its name. */
export function AudioBody({ block }: { block: AudioBlock }) {
  const { startMove } = useCanvasCtx();
  const url = useImageUrl(block.fileId);
  return (
    <div className="body audio-body">
      <div className="audio-head" title={block.name} onPointerDown={(e) => startMove(e, block.id)}>
        <Icon name="audio" size={16} />
        <span className="audio-name">{block.name}</span>
        {block.duration ? <span className="audio-len">{formatDuration(block.duration)}</span> : null}
      </div>
      {url ? <audio controls preload="metadata" src={url} aria-label={`Audio: ${block.name}`} /> : <div className="missing">{url === null ? 'Audio not found' : ''}</div>}
    </div>
  );
}
