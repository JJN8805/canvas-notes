# Interface principles

What the research says, what we found when we looked at the app, and the rules the interface now follows. Read this before
adding a screen, a menu entry or a button.

## What the research says

The evidence on note-taking apps specifically is thin (most of what is written is reviews and forum threads, not studies),
so the rules below lean on well-established usability findings and use the app reviews only as colour.

- **Recognition beats recall** (Nielsen Norman Group heuristic 6). Keep options visible. A feature that lives behind a screen
  you have to remember is a feature people never find. https://www.nngroup.com/articles/ten-usability-heuristics/
- **Flexibility and efficiency** (heuristic 7). Beginners get visible buttons; experienced people get accelerators
  (shortcuts, the command palette, gestures). Both must reach the same actions.
- **Aesthetic and minimalist design** (heuristic 8). Every extra element competes with the one that matters.
- **Chunking, not a magic number.** The "7 items" rule is a misreading of Miller; what helps is grouping related items under
  clear labels. Flat lists of ten or more are harder to scan than a few short groups. Hick's law bites hardest on unstructured
  lists. https://ixdf.org/literature/article/the-hick-hyman-law-an-argument-against-complexity-in-user-interface-design
- **Progressive disclosure.** Show the common path first; reveal the rest on request or when it becomes relevant.
  https://ixdf.org/literature/topics/progressive-disclosure
- **Empty states are onboarding.** A good one has a headline, one clear action, and a hint, and it points straight at the
  things you can do. https://nngroup.com/articles/empty-state-interface-design
- **Phone navigation:** a visible bar of at most five destinations beats a hidden menu; the bottom of the screen is the
  easiest to reach one-handed.
- **What people complain about in note apps:** a cluttered, deep sidebar (Notion), hunting for where things live; what they
  praise is a quick start and little ceremony (Apple Notes), plain files and links (Obsidian), nested organisation that shows
  in the sidebar (Bear).

## What we found in the app

1. A flat list of ten sidebar entries (Workspace, Journal, All pages, Groups, Tags, Cards, Ungrouped, Templates, Archive,
   Trash) with no grouping, and zero counts everywhere.
2. **Two different things were called "Workspace"**: the desks (Main, Student, Creator) and the documents / spreadsheets /
   slides / scripts hub.
3. Making anything other than a page needed knowing which screen to open first. New kinds of page (documents, scripts) were
   invisible unless you had opened the hub, and one copy had the hub switched off altogether.
4. The empty library offered only "New page" and an example.
5. The page header packed the page's own properties (group, tags, links) and the tools (outline, 3D, history, export) into
   one undivided row.

## The rules

- **Make things from one place.** The **New** button (sidebar on a laptop, the raised middle tab on a phone) lists everything that
  can be made, in the order people think of it: page, card, today's journal, then *Write or build* (document, spreadsheet,
  presentation, script), then group. `components/library/createMenu.ts` is the only list; a new kind of thing goes there.
- **Group the sidebar by intent**, with short uppercase headings: *Library* (All pages, Cards, Journal), *Organize*
  (Groups, Tags, Not in a group), *Studio* (documents, spreadsheets, presentations, scripts), and a quiet *Manage* block at
  the bottom (Templates, Archive, Trash). Counts show only when they are above zero.
- **One name per idea.** *Workspace* means a desk (Main, Student…); the make-things hub is **Studio**.
- **Empty states point at the doing.** The empty library shows "Or start with" tiles for every kind that can be made.
- **A laptop and a phone are different interfaces on purpose.** Words, hover and keys on a laptop; pictures, taps and sheets
  on a phone. The New menu is the same list on both; the sidebar's New button is hidden on a phone, where the middle tab does
  the same job.
- **Two groups in the page header**: what the page *is* (group, tags, links) then what to *do* with it (outline, 3D,
  history, export), divided by a thin rule on a laptop.
- **Every shortcut has a touch way and every icon-only button has a label** (`aria-label` and `title`).

## How to check a change against these

`node scripts/ia-check.mjs` (laptop and phone: grouping, the New menu, names, counts), then `npm run visual` and
`node scripts/phone-audit.mjs`, and read the screenshots.
