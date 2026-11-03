import { Group } from '../../types';
import { openTemplatePicker } from '../../store/picker';
import { type MenuItem } from '../../store/ui';
import { groupTree } from '../../lib/groups';

export const PAGE_MIME = 'application/x-canvas-page';
export const GROUP_MIME = 'application/x-canvas-group';
/** Touch screens: no drag-to-group (long-press opens the menu instead). */
export const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;


export function openNewPage() {
  openTemplatePicker();
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
