import { useEffect, useState } from 'react';
import { movePagesToWorkspace, useActiveWorkspace, useWorkspaceCounts, useWorkspaceList } from '../../store/workspaces';
import { PAGE_MIME } from './shared';
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

/**
 * While a page card is being dragged, the other workspaces appear under the switcher as places to drop it (moving it there, with an Undo),
 * the same way a card can be dropped on a group. Mouse only; a phone uses the card's menu.
 */
export function WorkspaceDrops() {
  const on = useFeature('workspaces');
  const list = useWorkspaceList();
  const open = useActiveWorkspace();
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => {
    const start = (e: DragEvent) => setDragging(!!e.dataTransfer?.types.includes(PAGE_MIME));
    const end = () => {
      setDragging(false);
      setOver(null);
    };
    document.addEventListener('dragstart', start);
    document.addEventListener('dragend', end);
    document.addEventListener('drop', end);
    return () => {
      document.removeEventListener('dragstart', start);
      document.removeEventListener('dragend', end);
      document.removeEventListener('drop', end);
    };
  }, []);
  const others = list.filter((w) => w.id !== open);
  if (!on || !dragging || !others.length) return null;
  return (
    <div className="ws-drops" role="group" aria-label="Drop the page on a workspace to move it there">
      {others.map((w) => (
        <div
          key={w.id || 'main'}
          className={'ws-drop' + (over === w.id ? ' over' : '')}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(PAGE_MIME)) {
              e.preventDefault();
              setOver(w.id);
            }
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData(PAGE_MIME);
            setOver(null);
            if (id) void movePagesToWorkspace([id], w.id);
          }}
        >
          <span className="ws-dot" style={{ background: colorVar(w.color) }} aria-hidden="true" />
          Move to {w.name}
        </div>
      ))}
    </div>
  );
}
