import { useEffect } from 'react';
import { initNotes, useNotes } from '../../store/notes';
import { Overlays } from '../ui/Overlays';
import { WidgetView } from './WidgetView';

/** The root of a widget window: opens the notes and shows one widget. No library, no sync, no shortcuts of the main app. */
export function WidgetApp({ pageId, blockId }: { pageId: string; blockId: string | null }) {
  const status = useNotes((s) => s.status);
  useEffect(() => {
    void initNotes();
  }, []);
  if (status !== 'ready') return <div className="widget widget-loading">{status === 'failed' ? 'Couldn’t open your notes.' : 'Opening…'}</div>;
  return (
    <>
      <WidgetView pageId={pageId} blockId={blockId} />
      <Overlays />
    </>
  );
}
