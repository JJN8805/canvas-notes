import { useActiveWorkspace, useWorkspaceCounts, useWorkspaceList } from '../../store/workspaces';
import { useFeature } from '../../store/features';
import { colorVar } from '../../lib/util';
import { Icon } from '../ui/Icon';
import { openWorkspaceMenu } from './workspaceMenu';

/** Which workspace is open, and the way to change it. In the sidebar it is a row under the app name; in the library toolbar (phones) a chip. */
export function WorkspaceSwitcher({ variant = 'side' }: { variant?: 'side' | 'toolbar' }) {
  const on = useFeature('workspaces');
  const list = useWorkspaceList();
  const open = useActiveWorkspace();
  const counts = useWorkspaceCounts();
  if (!on) return null;
  const here = list.find((w) => w.id === open) ?? list[0];
  return (
    <button
      className={`ws-switch ws-${variant}`}
      aria-label={`Workspace: ${here.name}. Switch or make a workspace`}
      aria-haspopup="menu"
      title="Switch workspace"
      onClick={(e) => openWorkspaceMenu(e.currentTarget, counts)}
    >
      <span className="ws-dot" style={{ background: colorVar(here.color) }} aria-hidden="true" />
      <span className="ws-name">{here.name}</span>
      <Icon name="chevron" size={14} />
    </button>
  );
}
