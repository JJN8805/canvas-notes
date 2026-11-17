import { useMemo } from 'react';
import type { TNode } from '../../../lib/tree3d';

interface Props {
  root: TNode;
  closed: ReadonlySet<string>;
  selected: string | null;
  matches: Set<string> | null;
  onToggle: (id: string) => void;
  onActivate: (n: TNode) => void;
  onFocusNode: (id: string) => void;
}

/** The same tree as an indented list: for the keyboard and screen readers, and to jump to something in the 3D picture. */
export function TreeList({ root, closed, selected, matches, onToggle, onActivate, onFocusNode }: Props) {
  const rows = useMemo(() => {
    const out: { n: TNode; level: number }[] = [];
    const walk = (n: TNode, level: number) => {
      out.push({ n, level });
      if (!closed.has(n.id)) n.children.forEach((c) => walk(c, level + 1));
    };
    walk(root, 0);
    return out;
  }, [root, closed]);
  return (
    <nav className="tree-list" aria-label="Library tree">
      <ul role="tree">
        {rows.map(({ n, level }) => {
          const folds = n.children.length > 0;
          return (
            <li
              key={n.id}
              role="treeitem"
              aria-level={level + 1}
              aria-expanded={folds ? !closed.has(n.id) : undefined}
              aria-selected={selected === n.id}
              className={`tl-row ${n.kind}${selected === n.id ? ' on' : ''}${matches && !matches.has(n.id) ? ' off' : ''}`}
              style={{ paddingLeft: 6 + level * 14 }}
            >
              {folds ? (
                <button className="tl-fold" aria-label={closed.has(n.id) ? `Open ${n.label}` : `Fold ${n.label}`} onClick={() => onToggle(n.id)}>
                  {closed.has(n.id) ? '▸' : '▾'}
                </button>
              ) : (
                <span className="tl-fold" aria-hidden="true" />
              )}
              <button
                className="tl-name"
                title={n.label}
                onClick={() => (n.kind === 'page' || n.kind === 'heading' ? onActivate(n) : onFocusNode(n.id))}
              >
                {n.label}
              </button>
              {n.kind === 'group' && <span className="tl-count">{n.weight}</span>}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
