import { useEffect } from 'react';
import { useRoute } from './lib/route';
import { initNotes, useNotes } from './store/notes';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { navigate } from './lib/route';
import { Library } from './components/library/Library';
import { Editor } from './components/editor/Editor';
import { Navigation } from './components/nav/Navigation';
import { Overlays } from './components/ui/Overlays';
import { TemplatePicker } from './components/library/TemplatePicker';
import { SettingsDialog } from './components/ui/SettingsDialog';
import { CardViewHost } from './components/cards/CardViewHost';
import { AddonOverlays } from './addons/AddonOverlays';
import { SyncPanel } from './components/sync/SyncPanel';
import { openJournal } from './store/journal';
import { dateKey, isTodayShortcut } from './lib/daily';
import { useDraw } from './store/draw';
import { useUi } from './store/ui';
import { initSync } from './sync/controller';
import { setupDesktopWidgets } from './widgets';

export function App() {
  const status = useNotes((s) => s.status);
  const error = useNotes((s) => s.error);
  const route = useRoute();

  useEffect(() => {
    void initNotes();
  }, []);

  // Ctrl+Alt+D opens the Journal at today from anywhere (today's page is made from the daily template if it doesn't exist yet).
  useEffect(() => {
    if (status !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      if (!isTodayShortcut(e)) return;
      if (useUi.getState().dialog || useDraw.getState().open) return;
      e.preventDefault();
      openJournal(dateKey());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [status]);

  useEffect(() => {
    if (status === 'ready') void initSync().catch((e) => console.error('Sync setup failed', e));
  }, [status]);

  // Bring back the desktop widgets (laptop app only).
  useEffect(() => {
    if (status === 'ready') void setupDesktopWidgets();
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
      {/* A failure in one page or screen leaves a message, not a blank window: the way back to the library stays. */}
      <ErrorBoundary
        resetKey={route.name === 'page' ? route.id : route.name}
        fallback={(error, reset) => (
          <div className="loading">
            <div className="load-error">
              <h1>This screen couldn’t be shown</h1>
              <p>Your notes are saved as you work and weren’t touched. {error.message ? `(${error.message.slice(0, 160)})` : ''}</p>
              <div className="row">
                <button className="btn" onClick={reset}>Try again</button>
                <button className="btn primary" onClick={() => { navigate({ name: 'library' }); reset(); }}>Back to the library</button>
              </div>
            </div>
          </div>
        )}
      >
        {route.name === 'page' ? <Editor key={route.id} pageId={route.id} /> : <Library />}
      </ErrorBoundary>
      <SyncPanel />
      <TemplatePicker />
      <SettingsDialog />
      <CardViewHost />
      <AddonOverlays />
      <Navigation />
      <Overlays />
    </>
  );
}
