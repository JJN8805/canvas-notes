// Excalidraw loads its fonts from a CDN unless told where they are. The app must work offline and its
// content security policy blocks remote fonts, so the fonts are copied next to the app and
// src/components/blocks/excalidrawAssets.ts points the library there. Run before `dev` and `build`.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
const to = join(root, 'public/excalidraw-assets/fonts');

if (!existsSync(from)) {
  console.error('Excalidraw is not installed: run `npm install` first.');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
// Xiaolai is the 13 MB Chinese/Japanese/Korean fallback. Text in those scripts uses the system font instead.
for (const dir of readdirSync(from)) if (dir !== 'Xiaolai') cpSync(join(from, dir), join(to, dir), { recursive: true });
console.log('Copied Excalidraw fonts to public/excalidraw-assets/fonts');
