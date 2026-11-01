// Imported before anything from @excalidraw/excalidraw, so the library finds its fonts in the app
// instead of fetching them from a CDN (see scripts/copy-excalidraw-assets.mjs).
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
