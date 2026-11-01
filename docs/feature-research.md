# Feature research: Obsidian 1.14.5

Source: the Linux tarball, inspected statically with REA (`inspect_desktop_application`, `analyze_javascript_application`) plus the command registry in `obsidian.asar/app.js`. Nothing was executed. Only feature names and behaviour were noted; no code or assets were copied.

Obsidian registers 200 command IDs across these areas. "Fit" is how well each maps onto Canvas Notes, which is a free canvas with boxes, local only, synced between devices.

## Already have (equivalent)
Canvas (boxes, arrows, frames), tags, search, page history (file-recovery), daily notes, templates, trash, export (PDF/PNG/MD), command-style shortcuts, themes (light/dark), backup.

## Gaps worth building (ranked by value ÷ effort)
| # | Feature | Obsidian IDs | Fit | Sync impact |
|---|---|---|---|---|
| 1 | **Command palette** (Ctrl+P) | `command-palette:open` | High | None (UI only) |
| 2 | **Quick switcher** (Ctrl+O) | `switcher:open` | High | None |
| 3 | **Internal links** `[[Page]]` in text boxes + **backlinks** panel | `backlink:*`, `outgoing-links:*` | High | Links derived from text, so nothing new is stored |
| 4 | **Outline** of a page (headings in text boxes, frame titles) | `outline:*` | High | None (derived) |
| 5 | **Bookmarks / starred pages** | `bookmarks:*` | High | New per-page flag: needs a migration and an engine field |
| 6 | **Properties** (typed key/value fields on a page) | `properties:*`, `markdown:add-metadata-property` | Medium | New per-page field: migration, engine, old-version tolerance |
| 7 | **Graph view** of pages and links | `graph:*` | Medium | None (derived from links) |
| 8 | **Note composer**: split/merge pages, extract a frame into a new page | `note-composer:*` | Medium | Uses existing page ops |
| 9 | **Bases** (database view of pages by properties) | `bases:*` | Medium | Depends on #6 |
| 10 | **Workspaces** (saved layouts), tabs, back/forward navigation | `workspaces:*`, `app:go-back` | Medium | Local only |
| 11 | **Slides** (present a page's frames as slides) | `slides:start` | Medium | None |
| 12 | **Footnotes, callouts, math (MathJax), Mermaid diagrams** in text boxes | formatting sandbox pages | Medium | New block content, not a new storage field |
| 13 | **Audio recorder** box | `audio-recorder:*` | Low | Large files sync |
| 14 | Web viewer / clipper | `webviewer:*` | Low | Conflicts with "no network unless the user triggers it" |

## Out of scope (do not map to this app)
- **Obsidian Sync / Publish**: replaced by our LAN sync.
- **Community plugins and themes**: our app has no plugin API.
- **Vault = folder of Markdown files**: our storage is SQLite, so this would be a different product.
- **Vim mode, multi-cursor, editor fold commands** (71 `editor:*` commands): these are Markdown-editor specific.

## Compatibility rules for any item above
- Anything that is stored needs a new entry in `MIGRATIONS` (`src/storage/tauri.ts`), a mirror in `src/storage/web.ts`, and handling in `src/sync/engine.ts`, and must be readable by the previous app version (unknown fields ignored).
- Items marked "derived" or "UI only" store nothing, so they cannot break sync. Do those first.
- Each feature goes in its own module (`src/lib/<feature>.ts` for logic, `src/components/<feature>/` for UI) with tests in `tests/`.
