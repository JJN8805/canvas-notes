import { useEffect, useState } from 'react';
import { widgetIdFor, withGeometry, type WidgetSpec } from '../../lib/widgets';
import { flushAll, getStorage, refreshFromDisk } from '../../store/notes';
import { getWidget, saveWidget } from '../../widgets/registry';
import { currentGeometry, fitWindowTo, onWindowChanged } from '../../widgets/host';

const SAVE_DELAY = 600;
const REFRESH_EVERY = 3000;

/**
 * What a widget window needs from the shell: its saved settings, remembering where it is left,
 * picking up edits made elsewhere (the main window, another widget) while it isn't being typed in, and
 * saving when it loses focus.
 */
export function useWidgetWindow(pageId: string, blockId: string | null): WidgetSpec | null {
  const id = widgetIdFor(pageId, blockId);
  const [spec, setSpec] = useState<WidgetSpec | null>(null);

  useEffect(() => {
    let live = true;
    void getWidget(getStorage(), id).then((s) => {
      if (!live) return;
      setSpec(s);
      // Once, at the start: correct the window so the page has the size the widget was saved with.
      if (s) void fitWindowTo(id, { w: s.w, h: s.h }).catch(() => {});
    });
    return () => {
      live = false;
    };
  }, [id]);

  // Remember position and size shortly after they stop changing.
  useEffect(() => {
    let timer = 0;
    let stop = () => {};
    let live = true;
    const save = async () => {
      const store = getStorage();
      const cur = await getWidget(store, id);
      if (!cur) return; // unpinned meanwhile
      const next = withGeometry(cur, await currentGeometry());
      await saveWidget(store, next);
      if (live) setSpec(next);
    };
    void onWindowChanged(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void save().catch(() => {}), SAVE_DELAY);
    })
      .then((s) => (live ? (stop = s) : s()))
      .catch(() => {}); // not in the desktop shell (a browser preview): nothing to listen to
    return () => {
      live = false;
      window.clearTimeout(timer);
      stop();
    };
  }, [id]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      if (!document.hasFocus()) void refreshFromDisk();
    }, REFRESH_EVERY);
    const onBlur = () => void flushAll();
    window.addEventListener('blur', onBlur);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return spec;
}
