# Storage design: each distinct thing is stored once

The rule: **a piece of data that appears in many places is stored once, and the places point at it.** What "the same" means differs per kind of data, so each has its own key.

| Data | Stored once by | Referenced from | Where |
|---|---|---|---|
| A picture, sound or PDF | its **content** (SHA-256 of the bytes, plus its type) | boxes (`imageId` / `fileId`), page covers | `images.sha256` → one file; several ids may share it |
| A box of a saved version | its **content** (first 128 bits of SHA-256 of its stable JSON) | every saved version of every page that contains it | `history_blocks` |
| A group, a card folder | its **id** | `pages.group_id` (a page names its group, it does not copy it) | `page_groups` (card folders are rows with `scope = 'cards'`) |
| A card | its **id** | card boxes on pages (`cardId`) | `pages` with `kind = 'card'` |
| A page title | the page | links `[[Title]]` are *read from the text*, never stored | `lib/links.ts` |
| Backlinks, outline, link graph, search | nothing: **worked out** from the pages | | `lib/links.ts`, `lib/search.ts` |

## What was duplicated before, measured

A library of 300 pages (12 boxes each, 25 tags reused, 6 distinct pictures each added to 5 pages, two saved versions per page):

| | before | after |
|---|---|---|
| Picture files | 30 files, 1.2 MB | **6 files, 240 KB** |
| Version history | 1.86 MB (a full copy per version) | 1.28 MB with only 2 versions per page; the gain grows with every version, since an unchanged box costs a 34-byte reference instead of its full text |
| "Graph" copy of every page (boxes again) | 1.28 MB | **removed** |
| Search index of that copy (text a third time) | 0.60 MB | **removed** |
| Graph nodes and edges (tags, groups, links again) | 52 KB | **removed** |

The graph copy had one reader, the "Linked from" button. That is now computed from the pages already in memory (`backlinksOf`), so there is nothing to keep in step.

## How files are shared

- `putImage(bytes)`: hash the bytes; if a row with the same hash and type exists, **return its id** (no write). Otherwise write one file and one row.
- `writeImage(id, bytes)` (a picture arriving by sync or from a backup under another device's id): hash it; if the bytes are already kept, add a row for this id **pointing at the existing file**. Page content keeps working, because ids in pages never change.
- `pruneImages`: a row goes when no page, trashed page or saved version uses its id; its **file** goes only when no row points at it any more.
- Files written by earlier versions have no fingerprint. `tidy()` checks them in small batches, merges identical ones, and can be stopped and restarted at any time.

## How history is shared

A saved version is `{"refs":["<fingerprint>", …]}`, the boxes in order. Each distinct box is one row in `history_blocks`. Saving a version stores only the boxes not already there; two pages with identical boxes (a duplicated page, a page made from a template) share rows. `sweepHistory` deletes boxes no version uses after history is thinned or a page is purged. Versions never leave the device, so this format is free to change; the older form (boxes written out) is still read, and `tidy()` converts it.

## What is deliberately not shared

- **A page's own boxes** stay inside the page (`pages.blocks`). A page is the unit that is saved, synced, backed up, exported and opened; keeping it whole means none of those has to reassemble it, and an older app version reads it as before. The cost: a page's current boxes also exist in its newest saved version (at most one extra copy of the page), and identical boxes on two different *live* pages are stored on each. Storing live boxes by reference too is possible (it would make every save and read go through the box store) but was left out as a much larger change to the save and sync path for a modest extra saving.
- **Tags** are a short list of words on each page (16 KB for 900 uses in the measurement). Making them a table would change the sync format for almost no space.
- **The sync wire format** is unchanged, so an older app version still syncs with this one. Shared storage is purely how this device keeps things.

## Upgrading

Migrations only add (v14 `history_blocks`, v15 `images.sha256/size`) and finally drop the old graph tables (v16). Nothing in pages, groups or pictures is rewritten by a migration; conversion of old data happens afterwards in `tidy()`.

## Checking it

Settings → Data → Storage shows what each part takes and what sharing saved. Tests: `tests/sharedStorage.test.ts` (files and history on the real database), `tests/upgrade.test.ts` (an install with the old graph tables), `tests/contentHash.test.ts`; in a browser, `node scripts/storage-check.mjs`.
