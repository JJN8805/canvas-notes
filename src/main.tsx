import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled with the app: nothing is fetched from the internet.
import '@fontsource-variable/onest';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import { App } from './App';
import { WidgetApp } from './components/widget/WidgetApp';
import { parseRoute } from './lib/routeParse';

// A desktop widget is the same app in a small window; its address says which box or page it shows.
const route = parseRoute(location.search, location.hash);
if (route.name === 'widget') document.documentElement.classList.add('is-widget');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{route.name === 'widget' ? <WidgetApp pageId={route.pageId} blockId={route.blockId} /> : <App />}</StrictMode>,
);
