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

### Add-ons (`src/addons/`)

Optional features, each a module in `src/addons/<id>/` listed in `addons/registry.ts` and loaded with a dynamic `import()` only
while switched on in Settings → Add-ons (`addons/store.ts`; the switch is saved as the `addons.enabled` setting). An add-on is an
`AddOnModule` (`addons/types.ts`): a `Settings` component, optionally a side `Panel`, `blockActions` (buttons on a box's hover bar)
`commands`, `navItem` + `View` (a sidebar entry that opens a full-page screen in the library; the filter is `{kind:'addon', id}`), `askHandler`
("ask" from the quick switcher), `cardPictureSources` (extra ways to give a card a picture), `FormatTool` (a button in the text formatting bar), `Overlay`
(floating UI mounted once for the app) and `onEmptyTextSpace` (space pressed in an empty text box). The core app only ever asks the store
what the running add-ons contribute, so switching one off removes it.
- `ai`: chat panel. Providers, request building and stream parsing are pure code in `src/lib/llm/` (tested without a network);
  `lib/llm/transport.ts` sends through the Rust proxy `src-tauri/src/ai.rs` (adds the API key, refuses any other destination,
  streams lines back) and falls back to `fetch` in the browser preview. The chat lives in memory only (`addons/ai/chat.ts`).
  `needsConfirmation` (chat.ts) is the rule for when the user must see what is about to leave their computer. `stream.ts` is the one
  streamed-answer path, shared by the chat panel, the Chat screen (`ChatView.tsx`) and the inline card (`InlineAi.tsx`, `inline.ts`, prompts in `tasks.ts`) that edits
  selected text and writes on an empty line. Each conversation is its own `createChat()` store (`panelChat` for the drawer, `mainChat`
  for the Chat screen), all in memory only.
  The assistant can also *propose* page edits (`ai/edits.ts` pure: labelled page context, parsing of the model's fenced `edits` JSON, `propose` = before/after with per-change problems incl. stale boxes; `ai/applyEdits.ts` applies accepted changes in ONE `mutatePage` so one undo step). The model never changes the page by answering; the user must press Apply in the proposal card (`Proposal` in `Panel.tsx`). Real box ids never go to the model (labels b1… via `AliasMap`). Tested in `tests/aiEdits.test.ts`, `tests/aiApply.test.ts`; end to end (mocked Ollama) with `node scripts/assistant-edit-check.mjs`.
- `ocr`: reads text in pictures with a local Ollama vision model and stores it in `ImageBlock.ocr`, which search and sync already carry.
A new add-on needs: an entry in the registry, a module under `src/addons/`, and tests; nothing else in the app should import it.

### The Journal

The daily pages as a book (`components/journal/JournalView.tsx`, state in `store/journal.ts`, pure helpers in `lib/journal.ts`). A day's page is
an ordinary page with `dailyDate` set, so storage, sync and backup are unchanged. The library's own lists use `listedPages` (no daily pages);
search, the switcher, links and the Chat picker still use `libraryPages`. The book shows one page (a two-page spread was tried and removed). Attendance pages (`attendanceLink`) are excluded from `listedPages` and reached by the Journal's Attendance button (`attendancePagesOf`). `Editor` has a `variant: 'journal'` (cut-down header) for the book's
right-hand page, and a page route that points at a daily page redirects to `openJournal(date)`. A day's page is only made by `openDailyPage` when
the day is opened (today) or started (any other day).

### Finite pages

`Page.sheet` (`{x,y,w,h}` in canvas coordinates, `lib/sheet.ts`) is the page's edges; absent/null = the original infinite canvas, so every page from before it existed, and older app versions (which ignore the field), stay infinite. `createPage` gives every new page a sheet (`sheet: null` asks for an infinite one). `mutatePage` calls `keepPageInside` after every recipe, so *any* way a box changes (drag, resize, paste, import, the assistant) ends inside the sheet; a box counts at its measured height (`blockHeight`, i.e. `ah`). `normalizePage` grows a stored sheet to cover its boxes (another app version may have put some outside). `setPageSize` / `growPage` (store/notes/mutate.ts) are the only ways to change it; `Canvas.tsx` draws the `.sheet` and scrolls only within it. Stored in the `pages.sheet` column (migration v10, JSON, '' = infinite) and in IndexedDB; carried through sync (`PageRecord.sheet`), conflicted copies and backups.

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
- Notes are private and local. No network requests unless the user triggers them. Note content goes only to Ollama
  on this computer, with one deliberate exception: the optional **AI assistant add-on** may send what the user chooses
  to share to Claude, OpenAI or Google Gemini (or to an Ollama on another computer), and only when the add-on is switched on, that
  provider is chosen, and the user has clicked Send on a preview of exactly what leaves (they can turn the preview off
  in Settings → Add-ons). The **OCR add-on** never sends anything but local Ollama. API keys live only in the Rust
  side's `ai-keys.json` (owner-only), never in SQLite, sync, backups, exports or page JavaScript. Chats are never saved.
  A picture is drawn from a typed description only (never page content) by OpenAI, Google Gemini or by a server the user chose: a Stable
  Diffusion WebUI or OpenAI-compatible image server, on this computer or elsewhere on their network (`ai.rs` allows those
  only on their own paths).
- The desktop app runs in WebKitGTK. Test visual and export features in `npm run desktop`, not
  only in a browser.
- Update README.md when adding user-facing features.


## Visual verification (do this after every change that touches the UI)

Type checks and tests do not show layout, focus or interaction bugs. Before saying a UI change is done, look at it:

1. `npm run dev` (leave it running), then `npm run visual`. It drives the real app in headless Chromium with sample data,
   writes a screenshot of every main screen to `.visual/`, and fails on any console error, failed request or exception.
2. **Read the screenshots** (the Read tool shows images) for the screens you changed and the ones next to them. Look for
   overlap, clipping, missing controls, wrong counts and empty states, not just errors.
3. Add the new screen or flow to `scripts/visual-check.mjs` so it is checked from now on.
4. Exercise the interaction, not just the layout: type, click, press Space and Enter, open and close dialogs. (A card
   detail that stole focus on every keystroke looked fine in a still screenshot and passed every test.)
5. The browser preview cannot show the Tauri shell: desktop widgets (always-on-bottom, tray, start at login, dragging),
   file save dialogs and exports in WebKitGTK. For changes there, build (`cd src-tauri && cargo build`) and run
   `scripts/desktop-run.sh` (throwaway data folder, never your real notes; add `--background` for the start-at-login
   path). This machine is a Wayland session with no screenshot tool for X windows, so inspect the windows with
   `xdotool search --name "Canvas Notes"`, `xdotool getwindowgeometry`, `xwininfo` and `xprop`, and have the page write
   measurements (`innerWidth`, `devicePixelRatio`, element boxes) to a file through the fs plugin while debugging
   (remove that code afterwards). Say clearly which parts were not seen.

- Robustness: pages are repaired on read by `lib/sanitize.ts` (via `normalizePage`); `ErrorBoundary` wraps the app, each screen and draw mode, so one failure never blanks the window. `node scripts/robustness-check.mjs` injects malformed pages and checks the app still opens.
