import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled with the app: nothing is fetched from the internet.
import '@fontsource-variable/onest';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
// Must run before the (lazily loaded) drawing code is evaluated: in a production build it reads this once, on load.
import './components/blocks/excalidrawAssets';
import { App } from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { WidgetApp } from './components/widget/WidgetApp';
import { parseRoute } from './lib/routeParse';

// A desktop widget is the same app in a small window; its address says which box or page it shows.
const route = parseRoute(location.search, location.hash);
if (route.name === 'widget') document.documentElement.classList.add('is-widget');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={(error) => (
        <div className="loading">
          <div className="load-error">
            <h1>Something went wrong</h1>
            <p>Your notes are saved as you work and weren’t touched. {error.message ? `(${error.message.slice(0, 160)})` : ''}</p>
            <button className="btn primary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      )}
    >
      {route.name === 'widget' ? <WidgetApp pageId={route.pageId} blockId={route.blockId} /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);
