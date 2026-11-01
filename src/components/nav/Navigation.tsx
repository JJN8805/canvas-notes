import { useEffect } from 'react';
import { closeNav, openNav, useNav } from '../../store/nav';
import { useRoute } from '../../lib/route';
import { useUi } from '../../store/ui';
import { useDraw } from '../../store/draw';
import { modKey } from '../../lib/util';
import { GraphView } from './GraphView';
import { OutlinePanel } from './OutlinePanel';
import { Palette } from './Palette';

/** The navigation overlays and their shortcuts: Ctrl+P command palette, Ctrl+O quick switcher. */
export function Navigation() {
  const open = useNav((s) => s.open);
  const route = useRoute();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!modKey(e) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'p' && k !== 'o') return;
      if (useUi.getState().dialog || useDraw.getState().open) return;
      e.preventDefault();
      const want = k === 'p' ? 'commands' : 'switcher';
      if (useNav.getState().open === want) closeNav();
      else openNav(want);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // A page's outline belongs to that page: leaving it closes the panel.
  useEffect(() => {
    if (useNav.getState().open === 'outline' && route.name !== 'page') closeNav();
  }, [route]);

  return (
    <>
      <Palette />
      {open === 'graph' && <GraphView />}
      {open === 'outline' && route.name === 'page' && <OutlinePanel pageId={route.id} />}
    </>
  );
}
