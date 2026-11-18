import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// What the app can say about itself (Settings → General): its version from package.json, the commit it was built from and when.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
})();

// Tauri expects a fixed dev port; TAURI_DEV_HOST is set when developing on a phone.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: {
    __FEATURE_PROFILE__: JSON.stringify(process.env.FEATURE_PROFILE ?? ''),
    __BUILD_INFO__: JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString(), mode: command === 'build' ? 'production' : 'development' }),
  },
  clearScreen: false,
  // The dev server keeps its pre-bundled libraries in a folder of its own. Tests, builds and other Vite processes share the default
  // `node_modules/.vite`, and one of them replacing the dev server's libraries under the open window ("Importing a module script failed")
  // was the cause of the desktop window refusing to open. (Vitest sets VITEST; it keeps the default folder.)
  cacheDir: command === 'serve' && !process.env.VITEST ? 'node_modules/.vite-dev' : 'node_modules/.vite',
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  // Libraries that are only imported lazily. Vite would find them late and re-bundle while the app is running, which makes files the
  // window already loaded answer "504 Outdated Optimize Dep" ("Importing a module script failed"). Listing them bundles them once, at start.
  optimizeDeps: {
    // Never look for more libraries while running: everything is listed below, and tests/viteDeps.test.ts fails if an import is missing.
    // (A late discovery re-bundles with a new hash, and every file the window already loaded answers 504.)
    noDiscovery: true,
    include: [
      '@tauri-apps/api/core',
      '@tauri-apps/api/event',
      '@tauri-apps/api/path',
      '@tauri-apps/api/window',
      '@tauri-apps/plugin-autostart',
      '@tauri-apps/plugin-dialog',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-sql',
      'html-to-image',
      // Everything the app imports at run time, so none of it is found late (which re-bundles and breaks the open window).
      'idb', 'dompurify', 'fflate', 'immer', 'turndown', 'zustand', 'zustand/middleware/immer', 'qrcode-generator', 'react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client',
      '@tiptap/react', '@tiptap/starter-kit', '@tiptap/extensions',
      'pdfjs-dist/legacy/build/pdf.mjs', '@excalidraw/excalidraw',
    ],
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'safari15',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 1500,
  },
}));
