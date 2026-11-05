// Imported by main.tsx (the entry), NOT by the drawing code: a production build evaluates the library's chunk before an import
// inside it, so the setting arrived too late and every font was requested from a CDN (blocked by the CSP). So the library finds its fonts in the app
// instead of fetching them from a CDN (see scripts/copy-excalidraw-assets.mjs).
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
