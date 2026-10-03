import { useEffect } from 'react';
import { useRoute } from './lib/route';
import { initNotes, useNotes } from './store/notes';
import { Library } from './components/library/Library';
import { Editor } from './components/editor/Editor';
import { Overlays } from './components/ui/Overlays';
import { SyncPanel } from './components/sync/SyncPanel';
import { initSync } from './sync/controller';

export function App() {
  const status = useNotes((s) => s.status);
  const error = useNotes((s) => s.error);
  const route = useRoute();

  useEffect(() => {
    void initNotes();
  }, []);

  useEffect(() => {
    if (status === 'ready') void initSync().catch((e) => console.error('Sync setup failed', e));
  }, [status]);

  if (status === 'loading') return <div className="loading">Opening your notes…</div>;
  if (status === 'failed') {
    return (
      <div className="loading">
        <div className="load-error">
          <h1>Your notes couldn’t be opened</h1>
          <p>{error}</p>
          <button className="btn primary" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {route.name === 'page' ? <Editor key={route.id} pageId={route.id} /> : <Library />}
      <SyncPanel />
      <Overlays />
    </>
  );
}
