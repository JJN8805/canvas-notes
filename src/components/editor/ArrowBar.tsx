import type { Arrow, ArrowheadMode } from '../../types';
import { deleteArrows, updateArrow } from '../../store/notes';
import { setSelectedArrow } from '../../store/canvas';
import { ask } from '../../store/ui';
import { Icon } from '../ui/Icon';

const HEAD_CYCLE: ArrowheadMode[] = ['one', 'both', 'none'];
const HEAD_GLYPH: Record<ArrowheadMode, string> = { none: '—', one: '→', both: '↔' };
const HEAD_LABEL: Record<ArrowheadMode, string> = { none: 'No arrowheads', one: 'Arrowhead at the end', both: 'Arrowheads at both ends' };

/** The floating menu for the selected arrow: label, arrowheads, line style, delete. */
export function ArrowBar({ pageId, arrow, mid }: { pageId: string; arrow: Arrow; mid: { x: number; y: number } }) {
  return (
    <div className="bar arrow-bar" style={{ left: mid.x, top: mid.y }} onPointerDown={(e) => e.stopPropagation()}>
      <button
        title="Set label"
        onClick={async () => {
          const v = await ask({ title: 'Arrow label', initial: arrow.label ?? '', okLabel: 'Set' });
          if (v !== null) updateArrow(pageId, arrow.id, (a) => void (a.label = v.trim() || undefined));
        }}
      >
        {arrow.label ? arrow.label.slice(0, 16) : 'Label'}
      </button>
      <button
        title={HEAD_LABEL[arrow.heads]}
        onClick={() => {
          const next = HEAD_CYCLE[(HEAD_CYCLE.indexOf(arrow.heads) + 1) % HEAD_CYCLE.length];
          updateArrow(pageId, arrow.id, (a) => void (a.heads = next));
        }}
      >
        {HEAD_GLYPH[arrow.heads]}
      </button>
      <button
        title={arrow.style === 'dashed' ? 'Make solid' : 'Make dashed'}
        onClick={() => updateArrow(pageId, arrow.id, (a) => void (a.style = a.style === 'dashed' ? 'solid' : 'dashed'))}
      >
        {arrow.style === 'dashed' ? '┄' : '─'}
      </button>
      <button
        title="Delete"
        onClick={() => {
          deleteArrows(pageId, [arrow.id]);
          setSelectedArrow(null);
        }}
      >
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}
