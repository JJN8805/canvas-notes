import { Group } from '../../types';
import { openTemplatePicker } from '../../store/picker';
import { featureOn } from '../../store/features';
import { useAddons } from '../../addons/store';
import { navigate } from '../../lib/route';
import { createPageFromTemplate, setFilter } from '../../store/notes';
import { toast, type MenuItem } from '../../store/ui';
import { groupTree } from '../../lib/groups';

export const PAGE_MIME = 'application/x-canvas-page';
export const GROUP_MIME = 'application/x-canvas-group';
/** Touch screens: no drag-to-group (long-press opens the menu instead). */
export const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;


/**
 * "New page". With the free canvas and templates on: the template picker. Templates off: a blank page right away. The free canvas off
 * (a Word and Excel only setup): the Workspace screen, where documents and spreadsheets are started.
 */
export function openNewPage() {
  if (featureOn('canvas')) {
    if (featureOn('templates')) return openTemplatePicker();
    const page = createPageFromTemplate(null);
    if (page) navigate({ name: 'page', id: page.id });
    return;
  }
  if (useAddons.getState().enabled.includes('office')) setFilter({ kind: 'addon', id: 'office' });
  else toast('Switch a feature on in Settings → Features to make pages.');
}


/** Menu entries for choosing a group, indented to show nesting. */
export function groupChoices(groups: Group[], current: string | null, pick: (id: string) => void, only?: Set<string>): MenuItem[] {
  return groupTree(groups)
    .filter(({ group }) => !only || only.has(group.id))
    .map(({ group, depth }) => ({
      label: '\u2002'.repeat(depth * 2) + group.name,
      dot: group.color,
      check: current === group.id,
      action: () => pick(group.id),
    }));
}
