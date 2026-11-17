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

A `Page` (`src/types.ts`) holds a `blocks: Block[]` array; each `Block` is a tagged union (`note`, `image`, `checklist`, `table`, `frame`, `audio`, `pdf`, `card`; see `BlockType` in `src/types.ts`) with its own shape plus shared `x/y/w/h/z` canvas geometry. `Page.rev` (distinct from the sync `etag`) detects concurrent edits *within* one device (e.g. two windows) at save time.

Groups nest arbitrarily deep (`Group.parentId`); the Groups screen shows them as cards you open (and pickers list them as an indented tree via `groupTree`, which is always fully expanded: there is no collapse state); `lib/groups.ts` holds the tree-building and cycle-prevention logic for moving a group into one of its own descendants.

### The note (text, sticky and code in one box)

`NoteBlock` (`type: 'note'`, `style: 'text' | 'sticky' | 'code'`; `html` for text and sticky, `code` for code) replaced the separate `text`, `sticky` and `code` types. Boxes stored in the old form are converted *when read* (`legacyNote` in `lib/note.ts`, called by `cleanBlock`), so the rest of the app only ever sees notes; what is saved is the note form, which **older app versions cannot show** (the user chose this over a compatible layout: update all devices first). Create with `addBlock(pageId, 'text' | 'sticky' | 'code', …)` (`AddKind`: the three styles are names for adding, the stored type is `note`); the stylesheet and thumbnails know a box by `kindClass(block)` (`b-text`, `b-sticky`, `b-code`), not by `block.type`. `setNoteStyleOf` (store/notes/blocks.ts) switches style as one undo step via the pure `setNoteStyle` (code drops formatting; `losesFormatting` says when to ask first). The assistant's own protocol still says text/sticky/code. Tests: `tests/note.test.ts`; browser: `node scripts/note-check.mjs`.

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
  "Ask my notes" (`ai/notesSearch.ts`, pure): `passagesOf` → `rankPassages` (BM25 + title/bigram bonuses, per-page and total caps) → `notesMessage` (`<notes>` with [n] numbers, a `</notes` inside a note is defused; real ids stay in the `NoteSource[]` table, which rides on `Message.sources` so "Try again" and the clickable citations work) → `citedSources` parses [1][2] in the answer. `ChatView.send` does the retrieval locally, then the normal `needsConfirmation`/`ConfirmShare` path (`hasPageText` also recognises `<notes>`); no hit = `mainChat.notice` (answered without a model, nothing sent). `askHandler(question, {pageIds})` lets the Weekly review hand a page to Chat. Tested in `tests/notesSearch.test.ts`; end to end (mocked Ollama, incl. the network confirm) with `node scripts/ask-notes-check.mjs`.
- `ai` also has a search-by-meaning layer (RAG): see "Searching notes by meaning" below.
- `office`: Workspace (see its own section below).
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

### Layers: boxes and the drawing

Box order is `z` within the boxes that share a parent (frames always behind plain boxes; `lib/frames.ts` `paintOrder`). The page drawing is one more layer: `lib/layers.ts` (pure) `splitByDrawing` splits the paint order into boxes *under* the drawing and boxes marked `Block.over` (the mark of the top-level ancestor counts, so a frame's contents follow the frame); `PageDrawing.behind` puts the whole drawing first. `Canvas.tsx`, `Thumbnail.tsx` and `export/export.tsx` (boxes below → ink → boxes above → arrows) all use it; add any new renderer of a page the same way. `stepOrder`/`stepBlocks` (forward/backward), `setOverDrawing`, `setDrawingBehind` (store/notes); `setPageDrawing` keeps `behind` across redraws. `components/editor/layerMenu.ts` is the one menu (front, back, above the drawing) used by the box bar, frame bar and multi-select bar; one-place moves are keyboard-only, Ctrl+[ / ] in `useCanvasKeyboard`. Both flags are optional and stored in the page JSON, so they sync and older versions ignore them. Tests: `tests/layers.test.ts`; browser: `node scripts/layers-check.mjs`.

### Tidy layout and the weekly review (core, no model involved)

`lib/tidy.ts` (pure) proposes a layout: align near edges (20 px), equalise near widths of text/list/code/table boxes, push overlapping boxes down, grow a finite sheet; frames carry their contents; it iterates to a fixed point so tidying a tidy page changes nothing. `applyTidy` (store/notes/mutate.ts) applies it as ONE `mutatePage` step and refuses when `layoutKey` no longer matches the proposal's `basis`. UI: `components/editor/TidyDialog.tsx` (before/after `Thumbnail`s), opened from the Page size menu or the palette via `store/tidy.ts`. `lib/weekly.ts` (pure) builds the week's draft (Mon–Sun; `fromKey` is *noon*, so edge-of-day maths uses its own `dayStart`) and `weeklyBlocks` lays it out; `components/journal/WeeklyReviewDialog.tsx` previews it and `createWeeklyPage` (store/weekly.ts) is the only place it is saved. Tests: `tests/tidy.test.ts`, `tests/tidyApply.test.ts`, `tests/weekly.test.ts`; browser: `node scripts/tidy-check.mjs`, `node scripts/weekly-check.mjs`.

### Interaction layer (menus, lock, map, shortcuts)

`components/editor/actions.ts` holds the shared box actions: `deleteWithUndo` (toast + Undo; locked boxes are kept), `quickAdd` (one-letter add at the pointer), `branchFrom` (Tab: sticky + arrow), `boxMenu` / `canvasMenu` (right-click, opened with `openMenuAt` in `store/ui.ts`). `Block.locked` (optional, JSON in the page, so it syncs and old versions ignore it) is honoured in `deleteBlocks`, `arrangeBlocks`, nudging, `startMove`/`startResize`, Tidy (`tidyPage` treats a locked box, or a frame holding one, as fixed; `applyTidy` skips locked ones again) and the assistant (`isEditable` is false for a locked box; `applyChanges` re-checks): **any new way of moving, resizing or deleting boxes must respect it**. Toasts about a page (`toast(..., owner)`) are removed when the page is left (`dismissToastsOwnedBy`), so an Undo never acts on a page that is not on screen. Ctrl+D and Ctrl+drag both copy a frame with its contents (`duplicateBlocksMap`); `addBlock(..., { arrowFrom })` makes the Tab branch one undo step. A page made from a template keeps the template's size (`null` = infinite) except the shipped templates, which are fitted (the mind map is infinite);  the pure rule is `lib/lock.ts`. `lib/arrange.ts` = align/distribute, `lib/minimap.ts` = map layout (`Minimap.tsx`, pref `editor.minimap`). The one-letter keys are a user setting (`lib/keymap.ts` pure: defaults, `setKey` refuses clashes, `cleanKeymap` repairs stored JSON; `prefs.keymap`, setting `editor.keymap`; the hook asks `actionFor(keymap, e.code)`), edited in Settings → About (`QuickKeys`). The hand tool is `useCanvas.hand` (Space-held-down made permanent via `spaceDown`). The shortcut list, `shortcutGroups(keymap)` in `lib/shortcuts.ts`, feeds both the `?` sheet and Settings → About: add new shortcuts there. Right-click rule: the system menu only while typing in that box (`editingAtPress` in `Canvas.tsx`). Tests: `tests/arrange.test.ts`, `lock.test.ts`, `minimap.test.ts`; browser: `node scripts/arrange-check.mjs`, `node scripts/interact-check.mjs`.

### Version and build info (Settings → General)

`vite.config.ts` defines `__BUILD_INFO__` (version from package.json, short git commit, build time, dev/production; typed in `src/build.d.ts`). `lib/appInfo.ts` (pure) reads it via `buildInfo()` (falls back to package.json under vitest), `describeEnvironment(userAgent)` and `diagnosticsText` (counts and names only, never note content or paths). Release notes are `lib/changelog.ts`, newest first. **Releasing: bump the version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml together and add a changelog entry on top**; `tests/appInfo.test.ts` fails if they disagree. UI: `components/ui/GeneralTab.tsx`; browser: `node scripts/general-check.mjs`.

### Graph view (one 3D picture: network and hierarchy)

`components/nav/GraphView.tsx` is the shell (a Network / Hierarchy switch = `prefs.layout`, search, edge details, `.graph-key`); opened as the `graph` overlay (`store/nav.ts`, palette command, feature `graph`). There is ONE set of nodes (library, groups, pages, cards, tags, headings) laid out two ways in one canvas: **network** (live 3D force simulation) or **tree** (the cone); switching glides every dot (`morph` in `Scene3D`). Pure code: `lib/scene3d.ts` (`buildScene` = `buildGraph` filters + `buildTree` + a Cards and a Tags section; returns the pruned `tree` and link `edges` by scene id `p:<id>`, `c:<id>`, `tag:<name>`, `g:<id>`; `matchNodes`, `sceneRadius`), `lib/graphModel.ts` (`buildGraph`: `linkGraph` + tag nodes + orphan/group/tag filter + local `here`/`depth`), `lib/graphSim.ts` (deterministic 3D force simulation: `createSim` keeps positions of `previous`, `stepSim`, `settle`, `reheat`, pinned `fx/fy/fz`), `lib/tree3d.ts` (`buildTree`, `finishTree`, `coneLayout`, camera `project`/`unproject`/`pick`/`frame`/`easeCamera`, `segmentDistance`; own perspective maths, no 3D library), `lib/graphPrefs.ts` + `store/graphPrefs.ts` (panel choices, localStorage `ui.graph`, cleaned on read; old `tab`/`links3d` still read). UI in `components/nav/graph/`: `Scene3D.tsx` (canvas 2D; a rAF loop that runs only while something moves; the camera follows the picture until the person moves it), `TreeList.tsx` (accessible tree; classes are `tl-<kind>` because `.card` is a global style), `GraphSettings.tsx`. The canvas has no elements, so browser checks ask it: `canvas.__screen()` returns node/edge screen positions, layout and sim `alpha`. Pitfalls found: **a rAF cleanup must reset its stored id to 0** (React dev StrictMode runs effects twice; a stale id froze the animation); while a dot is pressed the canvas holds pointer capture, so opening a dot happens in pointer-up; the wheel listener is a native non-passive one; in browser checks set a range input with `fill`, not a synthetic event (React ignores it). Tests: `tests/graphView.test.ts`; browser: `node scripts/graph-check.mjs` (also `links-check.mjs`, and the two graph screens in `visual-check.mjs`).

### A page in 3D (depth on boxes)

`Block.depth` (optional whole number, −1200..1200, positive = nearer; stored in the page JSON so it syncs/backs up and older versions ignore it; repaired in `cleanBlock`) is a depth the person *chose* for a box in the 3D page view; **absent means "follow the page's stacking"** and a stored 0 means "flat on purpose" (`chosenDepth` tells them apart). `effectiveDepths(blocks)` (lib/space.ts) gives every box its depth: the chosen one, else it rests on the highest overlapped box beneath it in `paintOrder` (`lib/frames.ts`: frames first, then by z), at that box's depth + `thicknessOf` + `LAYER_GAP`, so a box behind another on the page is behind it in 3D and blocks never interpenetrate (over `AUTO_LIMIT` boxes it gives up and leaves them at 0). Boxes are drawn as blocks (`boxSolid`, `visibleFaces` with `cameraPosition` from tree3d; thickness is about half the smaller side, 24..90; a frame is a 4-thick dashed backdrop). Other pure rules: `clampDepth`, `toWorld`/`toPage`, `pointInQuad`, `rayPlaneZ` (drag on a box's layer), `applyDepth(…, number | null)`, `flattenDepth`, `followStacking`, `snippet` (plain words for the canvas); frames and locked boxes are never layered by the person (`isLayerable`). UI: `components/nav/SpaceView.tsx` (nav overlay `'space'`, opened by the `3D` header button and the palette command, feature `space`, only on canvas pages; canvas 2D with the camera/projection from `lib/tree3d.ts`). Every change goes through `updateBlock` / `mutatePage` (a drag is one `beginGesture`/`endGesture` step, slider moves merge by key), so undo and sync are unchanged; new notes are made with `addBlock('sticky', …)`. Design rule from the research (Cockburn & McKenzie, Fabrikant et al.: occlusion and navigation cost, text hard to read in perspective): depth is for *placing*, writing and editing stay flat (`followLink` opens the box on the page). Camera movement is pure in `lib/spaceCamera.ts` (`zoomAt` keeps the point under the pointer fixed, `panBy` grabs the world, `orbitBy`, `glide` turns the short way, named `VIEWS` angled/front/side/top on keys 1-4, `spinStep` for the flick, `wheelFactor` with Ctrl = pinch); `SpaceView` animates `goal` (a camera to glide to) and `spin` in its one rAF, and handles two-finger touch. Double-click a box flies to it; Enter opens it on the page. Tests: the 'camera movement' block in `tests/space.test.ts`. Pitfalls found: a frame's centre can sort nearer than a box beside it, so frames sort by their far edge; hit-testing uses every visible face; the rAF cleanup must reset its id (StrictMode). Browser checks read the canvas through `canvas.__screen()` (boxes with depth and visible faces). Tests: `tests/space.test.ts`; browser: `node scripts/space-check.mjs` (and the 3D page screen in `visual-check.mjs`).

### Card folders (Cards screen)

Cards (`kind: 'card'` pages) are filed in their own tree of *folders* (top level) and *sections* (inside them, any depth), kept apart from page groups. They are rows of the same `page_groups` table told apart by `scope = 'cards'` (migration v11; `Group.scope`, `GroupRecord.scope`), so they sync and back up through the existing group paths and an older app version just shows them as groups. In the store they are `cardFolders` beside `groups` (`init.ts`/`refreshFromDisk` split on scope; `flushGroups` saves the union, because `saveGroups` removes whatever it is not given). A card's folder is `Page.groupId` pointing at a card folder; a card pointing at anything else (a page group from before, a deleted folder) is *unfiled*. Pure rules: `lib/cardFolders.ts`; actions: `store/cardFolders.ts` (deleting never deletes cards: they and the sections move up); UI: `components/cards/` (`CardsView`, `CardFolderTree`, `CardSections` = a section drawn like a frame: coloured heading, its cards, then its nested sections, recursively; `cardFolderMenu.ts`, `cardDnd.ts`). `Group.description` (card folders only; migration v12, `GroupRecord.description`) holds a section's description; `updateCardFolder` sets name and description together, and `store/cardEdit.ts` says which one is being edited (`FolderEditForm`, shown in a section or, for the opened place, under the title). Sections are shown in stored order (`childrenOf` does not sort; `reorderCardFolder` swaps neighbours; moving into a folder puts it last). Tests: `tests/cardFolders.test.ts`, `cardFolderStore.test.ts`, `cardFoldersStorage.test.ts`; browser: `node scripts/card-folders-check.mjs`, `node scripts/sections-check.mjs`, `node scripts/section-edit-check.mjs`, `node scripts/card-legacy-check.mjs`.

### Page cover images

`Page.cover` (`PageRecord.cover`; column `pages.cover`, migration v13, `''` = none, an image id otherwise; cleaned to a safe id in `normalizePage`) is the picture a page's library card shows instead of the `Thumbnail`. It is a page field like `sheet`, so it travels through every page SQL statement in `storage/tauri.ts`, `storage/web.ts`, sync (`insertLocalPage` conflict copies), backup and `templateFrom`. Which files a page uses is answered in ONE place, `pageFileIds` (`lib/files.ts`: its boxes' files plus its cover): sync, backup, `usedImageIds` and both `pruneImages` use it, and the desktop trash query keeps a trashed page's cover even when its boxes are empty — **anything new that lists a page's files must use it**. `store/pageCover.ts` (`setPageCover` stores the picture, `removePageCover`), `components/library/chooseCover.ts` (file picker + toast with Undo), shown by `CoverPicture` in `PageCard.tsx`. Tests: `tests/pageCover.test.ts`; browser: `node scripts/page-cover-check.mjs`.

### Closing the side panels

`store/layout.ts` (`useLayout`: `sidebar`, `cardTree`; pure parse in `lib/layoutPrefs.ts`, remembered in localStorage as `ui.layout`; unreadable = open) drives the library sidebar (`Library.tsx` adds `.side-closed`, shows `.side-open`; the toggle is in `Sidebar.tsx`) and the card folder tree (`CardsView.tsx` adds `.tree-closed`; toggle in `CardFolderTree.tsx`, show button in the breadcrumb row). Ctrl+\ / Ctrl+Shift+\ and `?` are handled in `Library.tsx` (a page has its own keyboard hook). On phone widths the sidebar is a top bar and ignores the closed state. Tests: `tests/layoutPrefs.test.ts`; browser: `node scripts/sidebars-check.mjs`.

### Shared storage (each distinct thing stored once)

Pictures and page history are stored by content, so adding or editing something that already exists adds almost nothing; `docs/storage-design.md` has the full picture and what is deliberately *not* shared. **Files:** `images` rows have `sha256`/`size` (migration v15); `putImage` returns the existing id for bytes already kept, `writeImage` (sync, backup) gives a new id the existing file, `pruneImages` deletes a file only when the last id using it is gone (`removeFileIfUnused`). **History:** `history_blocks(hash, json)` (v14) holds each distinct box once, keyed by a 128-bit fingerprint (`lib/contentHash.ts`: `stableJson`, `shareBlocks`, `assembleBlocks`); a `page_snapshots.blocks` value is `{"refs":[…]}`, and the older full-copy form (a JSON array) is still read. After history is dropped, `sweepHistory` removes boxes no version uses. **Older data** is converted in the background by `NotesStorage.tidy()` (run at startup in `init.ts`, and from Settings → Data → Storage → Tidy now): safe to run repeatedly and in any order. `NotesStorage.report()` feeds the Storage section (`lib/storageReport.ts`). IndexedDB (browser) does the same with `blobs` and `historyBlocks` stores (version 4). **Which files a page uses is `pageFileIds`; anything that lists a picture's id must also account for several ids sharing one file.** The old "graph" copy of every page (nodes/edges/blocks/search tables, `src/graph/`) was removed (migration v16 drops it): "Linked from" is `backlinksOf` in `lib/links.ts`, worked out from the pages in memory. Tests: `tests/contentHash.test.ts`, `sharedStorage.test.ts`, `upgrade.test.ts` (an install that still has the graph tables, from `tests/fixtures/oldGraphSchema.ts`), `storageReport.test.ts`, `links.test.ts`; browser: `node scripts/storage-check.mjs`.

### Links between boxes, pages and cards

`Block.links` (`BoxLink {page, block?}`, optional, in the page JSON, so it syncs/backs up and old versions ignore it; cleaned in `cleanBlock` via `cleanLinks`) is a deliberate link from any box or frame (a card's links live on its details box, `cardParts(...).body`) to a page, card, or one box on one. Pure rules in `lib/boxLinks.ts` (`resolveLink` says what is missing, `boxEdges`, `incomingLinks`, `linkTargets`); `lib/links.ts` merges them with `[[title]]` links: `backlinksOf` (pages and cards) and `linkGraph(pages, {cards, boxes, text})` (edges carry `kind`, nodes `kind`), `neighbourhood` for the local graph. Actions in `store/boxLinks.ts` (`addBoxLink`, `removeBoxLink`, `followLink` which scrolls to and selects the target box, `openLinkDialog`); UI: `components/nav/LinkDialog.tsx` (mounted in `App.tsx`), `editor/LinkBadge.tsx`, the Links button in the box bar/frame head/`boxMenu`, `cards/CardLinks.tsx`, `nav/GraphView.tsx`. Any new way of copying boxes keeps `links` for free (it is a block field). Tests: `tests/boxLinks.test.ts`; browser: `node scripts/links-check.mjs`.

### Workspace add-on (documents, spreadsheets, presentations)

Add-on `office` (`src/addons/office/`; screens in `components/office/`; actions in `store/office.ts`; pure logic in `lib/office/`: `formula.ts`, `sheetModel.ts`, `sheetNav.ts`, `slideOps.ts`, `starters.ts`, `app.ts`). Pages it makes are ordinary pages told apart by a marker on a box: `NoteBlock.doc` (document), `TableBlock.calc.page` (spreadsheet: the table's `rows` are the cells, `calc.fmt/colW/freeze` the rest) and `FrameBlock.slide` (a slide frame). `pageApp(page)` says which. They have no sheet (`sheet: null`) so nothing is pushed back inside edges. The add-on contributes `pageApps` (`AddOnModule`): a `Screen` that *replaces* the canvas (document, spreadsheet) or `Extras` shown beside it (the slide list); `Editor` asks `pageAppView(app)` from `addons/store.ts`, so with the add-on off the page is just a canvas page. Every edit goes through `editSheet` / `updateBlock` / `mutatePage` (undo and sync as usual); slides are moved and copied by pure functions over the block list (`slideOps.ts`). Present mode is the add-on's `Overlay` (`PresentMode`, state in `store/present.ts`). Tests: `tests/sheetNav.test.ts`, `slideOps.test.ts`, `officeStore.test.ts` plus the older formula and sheet tests; browser: `node scripts/office-check.mjs`.

### Compatibility, safety copy and dependency checks

`DATA_FORMAT` (`sync/engine.ts`) is how pages are written (2 = notes). The laptop says it in `hello`; a phone sends it with every request; `syncWithLaptop` stops if the laptop is older and the server (`minFormat`) refuses a client that does not say it is current. **Raise it whenever pages are saved in a form an older app cannot show.** `storage/preUpgradeCopy.ts` (pure bookkeeping over a tiny fs interface) copies `canvas-notes.db` (and `-wal`) to `backups/pre-<version>-<time>/` the first time a new app version opens it, keeping the newest three; it runs at the top of `createTauriStorage` and never blocks start-up. `scripts/audit-check.mjs` (`npm run audit:deps`, weekly in `.github/workflows/audit.yml`) fails on any shipped-package advisory that is not in its dated accepted list. The Rust side runs `cargo audit` from `src-tauri/`, whose accepted advisories (with the reason for each) are in `src-tauri/.cargo/audit.toml`; `audit-check.mjs` also fails when that file's `review-by` date has passed. Accepted today: `rsa` (lockfile-only, never compiled) and `libsqlite3-sys` (needs SQLx 0.9 / tauri-plugin-sql 3.x stable; the app only opens its own database). Warnings about unmaintained crates inside Tauri's GTK/D-Bus stack do not fail the job. Tests: `tests/syncFormat.test.ts`, `preUpgradeCopy.test.ts`, `roundtrip.test.ts` (every box type through backup, sync and Markdown).

### Feature switches (what a copy of the app shows)

`lib/features.ts` (pure) lists every switchable feature (`FEATURES`), the ready-made `PROFILES` and the rules (`needs`, `effectiveOff`, `profileOf`, `parseDisabled`); `store/features.ts` keeps the choice in the `features.disabled` setting (`useFeature(id)` in components, `featureOn(id)` elsewhere, `applyProfile` also sets the Workspace add-on), loaded in `init.ts` before the first screen. A build can start with a profile: `FEATURE_PROFILE=office|documents|notes` becomes `__FEATURE_PROFILE__` (vite `define`), used only when nothing is saved. A switched-off feature is **hidden, never deleted or blocked in storage**: pages, cards and links stay in the database, sync and backups. **Any new screen, menu entry, toolbar button, shortcut or palette command belongs to a feature and must be gated** (`useFeature` / `featureOn`; palette commands carry `feature`); a new feature needs an entry in `FEATURES` (and a place in the profiles), a gate at each entry point, and a test in `tests/features.test.ts`. Gated today: sidebar entries and library screens (a hidden one falls back to All pages), New page (`openNewPage` in `components/library/shared.ts`), editor header, add toolbar, box bar, link UI and the `[[` picker, journal shortcut and redirect, widgets, sync start-up and its settings tab. Workspace runs by default (`loadAddons`). Tests: `tests/features.test.ts`, `featuresStore.test.ts`; browser: `node scripts/features-check.mjs` and `scripts/profile-build-check.mjs` (against a second dev server with `FEATURE_PROFILE` set).

### Enter as a dialog's main button, and the dev server's dependency list

`lib/enterConfirm.ts` (pure: `confirmsOnEnter`, `enterKey`) is the one rule for when Enter confirms a dialog: from a one-line field or empty space, never from a button, list, select, link or rich text box, never when already handled below (the tag field) or while composing text; Ctrl/Cmd+Enter confirms from anywhere. Wire a dialog by calling it in the dialog's `onKeyDown` (card detail also catches Ctrl+Enter in the document capture phase, ahead of the editor). **Never wire it to a dialog that sends data off the computer** (`ConfirmShare`). `vite.config.ts` lists every run-time dependency in `optimizeDeps.include`: a dependency found late makes Vite re-bundle while the app is open and every file the window already loaded answers 504 ("Importing a module script failed"). **Add any new npm dependency there.** Workspace files: `export/officeExport.ts` zips the pure builders `lib/office/xlsx.ts` and `docx.ts`; `export/officeImport.ts` reads `.docx`/`.xlsx`/CSV (`lib/office/ooxml.ts` is the DOM-free XML reader, `xlsxImport.ts` and `docxImport.ts` the readers: only listed parts are unzipped, parts that unpack to over 60 MB and files over 25 MB are refused, and Word text is escaped into tags the importer chooses); open the generated files in LibreOffice after changing them (tests only check structure). Tests: `tests/enterConfirm.test.ts`, `officeFiles.test.ts`; browser: `node scripts/enter-check.mjs`.

### Searching notes by meaning (RAG, in the AI add-on)

`addons/ai/rag/` (all pure except `runtime.ts`, `RagSettings.tsx`, `SearchInfo.tsx`): `vectors.ts` (normalise, int8 quantise to a base64 string + scale, cosine `dot`, `topK`), `plan.ts` (`passageHash`, `indexPlan`: what to embed and what to forget; at most 60,000 passages, most recently edited kept), `fuse.ts` (reciprocal rank fusion), `embedApi.ts` (request builders and *validating* parsers for Ollama `/api/embed`, OpenAI `/v1/embeddings`, Gemini `:batchEmbedContents`; the API key is never in the request, the Rust side adds it), `client.ts` (sends through `lib/llm/transport`; Ollama 404 falls back to `/api/embeddings`), `memory.ts` (`VectorIndex` loaded per model), `indexer.ts` (`createIndexer`: batches, stores each batch as soon as it is made, never throws into the UI, a failure is shown and not retried in a loop), `retrieve.ts` (`retrieveNotes`: word ranking from `notesSearch.scorePassages` + vector ranking, fused, then `selectPassages` with the same caps; if the meaning side is unavailable the result is the word ranking plus a `note`), `config.ts` (`ai.rag` setting), `runtime.ts` (real deps; `startRag()` is called by the add-on, indexes ~3 s after start and ~5 s after pages change, only while the AI add-on is on; `retrieveForQuestion`). Vectors live in `NotesStorage.vectors` (`VectorStore`: desktop table `embeddings`, migration v17; browser IndexedDB store `embeddings`, version 5): **derived data, never synced or put in a backup**, rebuilt on each device, rows validated on read (`cleanVectorRow`). **Privacy rules (do not weaken):** the default source is Ollama (`local`); a cloud source (`openai`, `gemini`) only runs when `cloudConsent === source`, which is set only by `agreeToCloudEmbedding` after the confirm dialog in `RagSettings` and is cleared when the source changes; `cleanRag` puts any unagreed cloud source back to `local`; the Rust allowlist (`ai.rs` `check_target`) accepts only `batchEmbedContents` besides the older Gemini methods (hostile addresses are tested). Integrations: Chat screen (`ChatView.send`, async, one retrieval at a time), assistant drawer (`Panel.send`, "Also search my other notes", other pages only, `REFERENCE_PROMPT`), "Write with AI" (`InlineAi.writeMessage`, off by default, `inlineNotes`). Tests: `tests/rag.test.ts`, `vectorStore.test.ts`, Rust `ai::tests`; browser: `node scripts/rag-check.mjs` (mocked Ollama and embedder).

### Slash menu and calmer chrome

Press `/` on a page (not while typing; gated by feature `canvas`): `useCanvasKeyboard` calls `openSlash` (`store/slash.ts`: screen point, world point, focus callback), `components/editor/SlashMenu.tsx` (mounted in `Editor`) shows a filter field and the box types and adds the pick with `quickAdd` at the pointer. The list and its ranking are pure in `lib/slashItems.ts` (`SLASH_ITEMS`, `filterSlash`: name prefix, then another name, then anywhere). A new box type belongs in `SLASH_ITEMS` too. The menu is positioned with opacity (not `visibility: hidden`, which cannot take focus). Styling follows the research on Notion/Linear/Obsidian: the end of `styles.css` makes the library content `--sheet` white beside a `--desk` sidebar, gives header buttons no box until hover (`.ed-head .btn`), hides header labels (`.ed-lbl`) below 1640 px (every such button keeps `aria-label` + `title`), and adds shared transitions (off under `prefers-reduced-motion`). Tests: `tests/slashItems.test.ts`; browser: `node scripts/slash-check.mjs`.

### Favorites, Recent, focus mode, menu keys, the orientation cube

Starred pages are a per-device convenience, not page data: `store/favorites.ts` (localStorage `ui.favorites`, repaired by pure `lib/favorites.ts`: `parseFavorites`, `toggleFavorite`, `favoritePages`, `recentPages`), listed by `PageShortcuts` in `Sidebar.tsx` (Favorites, then the 5 latest edited, starred ones left out) and toggled by the star in the page header. Focus mode (`store/focusMode.ts`, Ctrl+Shift+F in `useCanvasKeyboard`, palette command, `.editor.focus-mode` hides header/tools/zoom/map, reset when the page changes) is not remembered. A `MenuItem` label written `"Name  (Key)"` (two spaces) is drawn with the key at the right edge (`splitKeyHint` in `Overlays.tsx`): keep that form for new menu shortcuts. `/` typed into an *empty* text or sticky box opens the slash menu with `replace` set (the choice replaces that empty box, `SlashMenu.tsx`). In the 3D page view the corner cube is pure `cubeFaces`/`FACE_VIEW` in `lib/spaceCamera.ts` (orthographic, same turn as the picture), drawn and hit-tested in `SpaceView`; the angled view looks from above (negative pitch). Tests: `tests/favorites.test.ts`, `menuKeys.test.ts`, the orientation cube block in `tests/space.test.ts`; browser: `node scripts/slash-check.mjs` (also covers focus mode, menu keys, favorites).

### Page icons, turn-into, remembered 3D view

`Page.icon` (`PageRecord.icon`; column `pages.icon`, migration v18, `''` = none; cleaned by `cleanIcon` in `lib/pageIcon.ts`: short plain text only, no markup, quotes or control characters) is a page field like `cover`, so it travels through every page statement in `storage/tauri.ts` (the new parameter is always appended last, `$17` in `pageValues`; do not renumber), `storage/web.ts`, sync (`insertLocalPage` conflicted copies), backup and `templateFrom`; older app versions ignore it. Set with `choosePageIcon` (`store/pageIcon.ts`, an `ask` dialog); drawn by `.page-icon` in `PageCard`, the sidebar rows, the switcher and the header's `IconButton`. "Turn into": `/` at the very start of a note with words (`useCanvasKeyboard`) opens the slash menu with `turn` set; `turnNoteInto` (`store/turnInto.ts`, pure parts in `lib/turnInto.ts`: `noteLines`, `noteToChecklist`) changes the note in one undo step (text/sticky/code through `setNoteStyleOf`, to-do through one `mutatePage` that keeps id, place, colour, lock and links). In the 3D view: the last camera of each page is kept per device in localStorage (`ui.space.camera.<page id>`, `parseCamera` validates it), `effectiveDepths` files boxes in a grid (`CELL`, `MAX_CELLS`; `AUTO_LIMIT` is 8000) and is tested against comparing every pair, the selected box has a depth grip (`handleOf`), Tab walks the boxes and a polite live region announces the selection. Tests: `tests/pageIcon.test.ts` (desktop database, sync, conflicts, backup), `slashItems.test.ts` (turn-into rules), `space.test.ts`; browser: `slash-check.mjs`, `space-check.mjs`.

### Snap guides

`src/lib/guides.ts` contains the pure math for edge/center snapping while dragging/resizing; it's unit-tested in isolation from the canvas component.

## Security standards and modularity (check every change against these)

- **Validate outside data at the boundary.** Anything read from storage, sync, a backup, an import, the address bar, an event payload or a model's answer is repaired or refused before use: pages in `lib/sanitize.ts` (`cleanBlock`, `cleanLinks`), ids with `isSafeId` and other checks in `src/storage/validate.ts`, network and window checks in `src-tauri/src/guard.rs`. New stored fields get a cleaner there.
- **Never render untrusted HTML.** Rich text outside the editor goes through `sanitizeHtml` (DOMPurify, allow-list); assistant text is escaped first (`ai/markdown.ts`). No `eval`, `new Function`, `document.write` or unsanitised `innerHTML`.
- **SQL is always parameterised.** No string-built queries; ids that reach a selector use `CSS.escape`.
- **Least privilege.** Tauri capabilities (`src-tauri/capabilities/`) list only what a window needs (the widget windows get less than the main one); the CSP in `tauri.conf.json` allows only `'self'` plus what the app needs (no frames, objects or remote scripts). Adding a permission or CSP source needs a reason written next to it.
- **Secrets stay in Rust.** API keys live in `ai-keys.json` (owner-only), never in SQLite, sync, backups, exports or page JavaScript. Randomness for keys and nonces comes from the OS (`OsRng`, `crypto.getRandomValues`), never `Math.random`.
- **No network unless the user triggers it,** and what leaves is shown first (see Principles).
- **A development build must never act like an installed one:** it refuses "start at login" (`autostartBlockedReason`) and a debug build started with `--background` exits at once, so a leftover login entry can't open a window with no dev server.
- **Test with hostile input** (`tests/` already does for ids, URLs, widgets, backups, markdown). Known, accepted: `npm audit` reports issues inside Excalidraw's Mermaid import (`@excalidraw/mermaid-to-excalidraw`, lodash-es, nanoid), which only runs on text the user pastes into the drawing tool, offline; the fix is a breaking downgrade of Excalidraw. Recheck on each Excalidraw upgrade.
- **Modularity:** one concern per file, new features as new files, no new import cycles.

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
