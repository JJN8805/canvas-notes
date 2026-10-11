# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Canvas Notes: a free-canvas notes app (text, images, checklists, code, tables as draggable/resizable boxes on a page). Runs as a Tauri desktop app (Linux/Windows/macOS) and on Android, syncing directly between devices over LAN with no server or account. Storage is SQLite + image files on disk (desktop/phone) or IndexedDB in the browser dev server.

## Commands

```bash
npm run dev            # browser UI at http://localhost:1420, IndexedDB storage, no sync — fastest loop for UI work
npm run desktop         # full Tauri app (SQLite, real sync) — first launch compiles Rust, ~5-10 min
npm run desktop:build   # produce .deb / AppImage installers
npm test                # vitest run (tests/**/*.test.ts), against real SQLite storage + sync engine
npx vitest run tests/sync.test.ts   # run a single test file
npx vitest run -t "name"            # run tests matching a name
npm run typecheck       # tsc --noEmit
npm run build           # tsc --noEmit && vite build
cd src-tauri && cargo test          # Rust-side encryption/transport tests
npm run icons           # regenerate src-tauri/icons from app-icon.png (1024x1024)
```

Android commands (`android:init`, `android:dev`, `android:apk`) require Android Studio/SDK/NDK setup described in README.md; not needed for ordinary web/desktop-logic changes.

There is no lint script configured; rely on `typecheck` and `tsc`'s strict settings.

## Architecture

### Storage is swapped at runtime, not at build time

`src/storage/index.ts` picks the backend by checking `window.__TAURI_INTERNALS__`: Tauri → `storage/tauri.ts` (SQLite via `@tauri-apps/plugin-sql` + image files), otherwise → `storage/web.ts` (IndexedDB, used by `npm run dev`). Both implement the single `NotesStorage` interface in `storage/types.ts`. When changing storage behavior, update both backends or the two targets silently diverge — `tests/` exercises the real implementations, not mocks.

### Every row carries sync metadata, not just content

Pages and groups each have `etag` (changes on every local save), `synced` (the etag both devices last agreed on), and `deleted` (tombstone, so deletions propagate). A row has unsynced local changes exactly when `etag !== synced`. This is the basis for all conflict detection — see `storage/types.ts` (`SyncStore`, `SaveResult`) and `sync/engine.ts` for the merge logic:
- edit vs. edit → both kept, the incoming one renamed "(conflicted copy)" via `insertLocalPage`
- edit vs. delete → edit wins
- stale write (etag moved since read) → rejected, caller must reload

`sync/controller.ts` drives *when* syncing happens (on focus, every 2 minutes, ~20s after an edit) and owns the laptop-side LAN service / phone-side client lifecycle. `sync/engine.ts` is the pure "what to send/fetch/apply" logic, kept separate so it can be tested without any networking (`tests/sync.test.ts` runs two real storage instances — a fake "laptop" and "phone" — through it).

The actual encrypted transport (ChaCha20-Poly1305, keyed from a pairing code that never crosses the network) lives in Rust: `src-tauri/src/sync.rs`. The laptop hosts a small LAN service on port 47821; the phone connects to it directly.

### Pages are documents of positioned blocks

A `Page` (`src/types.ts`) holds a `blocks: Block[]` array; each `Block` is a tagged union (`text`, `image`, `checklist`, `code`, `table`) with its own shape plus shared `x/y/w/h/z` canvas geometry. `Page.rev` (distinct from the sync `etag`) detects concurrent edits *within* one device (e.g. two windows) at save time.

Groups nest arbitrarily deep (`Group.parentId`), rendered as an expandable tree in the sidebar; `lib/groups.ts` holds the tree-building and cycle-prevention logic for moving a group into one of its own descendants.

### Adding a new block type

1. Add the type in `src/types.ts`.
2. Add a body component in `src/components/blocks/`.
3. Render it from `BlockFrame.tsx`.
4. Add a toolbar button in `Editor.tsx` (under `src/components/editor/`).

Undo/redo, saving, sync, and thumbnail rendering all work generically off the `Block` union — no changes needed there.

### Schema migrations

Desktop schema changes go in the `MIGRATIONS` array in `src/storage/tauri.ts`; each entry runs once against existing databases. There's a dedicated test (`tests/sync.test.ts` or similar) covering upgrade from the very first schema version — don't break that path.

### State management

Zustand stores under `src/store/`: `notes.ts` (pages/groups/tags — the biggest store), `canvas.ts` (viewport/selection), `history.ts` (undo/redo — one keystroke run is one undo step), `images.ts`, `ui.ts` (toasts/dialogs).

### Export

`src/export/export.tsx` handles all three export formats: Markdown (+ zip with images via `fflate`), PDF (a small hand-rolled writer producing a pixel-exact rasterization of the canvas, not selectable text), and PNG (via `html-to-image`). Tests assert against real PDF/Markdown output, not snapshots of internal calls.

### Snap guides

`src/lib/guides.ts` contains the pure math for edge/center snapping while dragging/resizing; it's unit-tested in isolation from the canvas component.

## Code style notes

- Strict TypeScript (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` all on) — keep changes clean under `tsc --noEmit`.
- Keep `sync/engine.ts` free of I/O/platform calls; it's designed to be testable with plain fakes (`tests/fakes.ts`).

## Canvas Notes rules

Commands: `npm run desktop` (run app), `npm run typecheck`, `npm test`, `cd src-tauri && cargo test`.
After every change: typecheck and tests must pass. Add tests for new logic in `tests/`.

Architecture:
- Every page edit goes through `mutatePage`/`updateBlock` in `src/store/notes.ts`. Pick the right
  history mode so undo/redo works.
- Block types: `src/types.ts`, bodies in `src/components/blocks/`, rendered by `BlockFrame.tsx`.
  Thumbnails (`Thumbnail.tsx`) and exports (`src/export/export.tsx`) must also handle new types.
- Database schema changes ONLY as new entries in `MIGRATIONS` in `src/storage/tauri.ts`.
  Never edit old migrations. Mirror changes in `src/storage/web.ts`.
- Anything stored must sync (`src/sync/engine.ts`) and stay readable by the previous app version.

Principles:
- Notes are private and local. No network requests unless the user triggers them, and never send
  note content anywhere except local Ollama.
- The desktop app runs in WebKitGTK. Test visual and export features in `npm run desktop`, not
  only in a browser.
- Update README.md when adding user-facing features.
