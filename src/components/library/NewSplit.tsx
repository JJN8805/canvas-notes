import { Icon } from '../ui/Icon';
import { createCount, openCreateMenu } from './createMenu';
import { openNewPage } from './shared';

/**
 * The library's main action as a split button: the left part does the usual thing (a new page), the arrow opens the whole New menu
 * (card, today's journal page, document, spreadsheet, presentation, script, group). With nothing else to offer it is one plain button.
 */
export function NewSplit({ canvasOn }: { canvasOn: boolean }) {
  const more = createCount() > 1;
  return (
    <div className={'split-btn new-page-btn' + (more ? '' : ' single')}>
      <button className="btn primary split-main" onClick={openNewPage}>
        <Icon name="plus" size={16} />
        {canvasOn ? 'New page' : 'New…'}
      </button>
      {more && (
        <button className="btn primary split-caret" aria-haspopup="menu" aria-label="More things to make: card, document, spreadsheet, presentation, script…" title="More things to make" onClick={(e) => openCreateMenu(e.currentTarget.parentElement as HTMLElement)}>
          <Icon name="chevron" size={16} />
        </button>
      )}
    </div>
  );
}
